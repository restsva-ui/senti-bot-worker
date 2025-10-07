// src/lib/drive.js
// Google Drive клієнт для Cloudflare Workers на базі Service Account (JWT).

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_UPLOAD_MULTIPART = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";

function getCreds(env) {
  if (!env.GOOGLE_DRIVE_CREDENTIALS) throw new Error("Missing secret GOOGLE_DRIVE_CREDENTIALS");
  let creds;
  try { creds = JSON.parse(env.GOOGLE_DRIVE_CREDENTIALS); }
  catch { throw new Error("GOOGLE_DRIVE_CREDENTIALS is not valid JSON"); }
  if (!creds.client_email || !creds.private_key) {
    throw new Error("GOOGLE_DRIVE_CREDENTIALS must include client_email and private_key");
  }
  return creds;
}

function pemToArrayBuffer(pem) {
  const raw = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(raw);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function b64url(bytes) {
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encJSONUrlSafe(obj) {
  const txt = JSON.stringify(obj);
  const b = new TextEncoder().encode(txt);
  return b64url(b);
}

async function getAccessToken(env) {
  const creds = getCreds(env);
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: creds.client_email,
    sub: creds.client_email,
    scope: "https://www.googleapis.com/auth/drive.file",
    aud: OAUTH_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${encJSONUrlSafe(header)}.${encJSONUrlSafe(claim)}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(creds.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`;

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("token_error: " + JSON.stringify(data));
  return data.access_token;
}

function ensureFolder(env) {
  const id = env.DRIVE_FOLDER_ID;
  if (!id) throw new Error("Missing DRIVE_FOLDER_ID (Cloudflare Variable)");
  return id;
}

export async function drivePing(env) {
  const token = await getAccessToken(env);
  const folderId = ensureFolder(env);
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await fetch(`${DRIVE_FILES_URL}?q=${q}&pageSize=1&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Drive ping failed: " + (await res.text()));
  return true;
}

function guessNameFromUrl(u) {
  try {
    const url = new URL(u);
    const last = url.pathname.split("/").pop() || "file";
    return last.includes(".") ? last : (last + ".bin");
  } catch {
    return "file.bin";
  }
}

function mimeFromExt(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  const map = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
    webp: "image/webp", heic: "image/heic", heif: "image/heif",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
    mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg",
    pdf: "application/pdf", txt: "text/plain", csv: "text/csv", json: "application/json",
    zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
  };
  return map[ext] || "application/octet-stream";
}

// --------- базові завантаження ----------

export async function driveSaveFromUrl(env, fileUrl, nameOptional) {
  const token = await getAccessToken(env);
  const folderId = ensureFolder(env);

  const src = await fetch(fileUrl);
  if (!src.ok) throw new Error(`Fetch failed: ${src.status}`);

  const buf = new Uint8Array(await src.arrayBuffer());

  const filename = (nameOptional && nameOptional.trim()) || guessNameFromUrl(fileUrl);

  // Визначаємо MIME: спочатку з відповіді, далі — за розширенням, фолбек — octet-stream
  const ctFromSrc = (src.headers.get("content-type") || "").split(";")[0].trim();
  const contentType = ctFromSrc || mimeFromExt(filename);

  const boundary = "----senti-drive-" + Math.random().toString(16).slice(2);

  // Важливо: передаємо mimeType також у метадані, щоб Drive коректно ідентифікував файл/прев’ю
  const metadata = { name: filename, parents: [folderId], mimeType: contentType };

  const enc = new TextEncoder();
  const metaPart =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n`;

  const filePartHeader =
    `--${boundary}\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`;

  const footer = `\r\n--${boundary}--\r\n`;

  const body = new Blob([enc.encode(metaPart), enc.encode(filePartHeader), buf, enc.encode(footer)]);

  const upload = await fetch(DRIVE_UPLOAD_MULTIPART, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const info = await upload.json();
  if (!upload.ok) throw new Error("upload_failed: " + JSON.stringify(info));

  return { id: info.id, name: info.name, link: `https://drive.google.com/file/d/${info.id}/view` };
}

export async function driveList(env, limit = 10) {
  const token = await getAccessToken(env);
  const folderId = ensureFolder(env);
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const fields = encodeURIComponent("files(id,name,modifiedTime,size,webViewLink)");
  const res = await fetch(`${DRIVE_FILES_URL}?q=${q}&orderBy=modifiedTime desc&pageSize=${limit}&fields=${fields}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error("list_failed: " + JSON.stringify(data));
  return data.files || [];
}

// --------- логування у текстовий файл ----------

async function findFileByName(env, name) {
  const token = await getAccessToken(env);
  const folderId = ensureFolder(env);
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`);
  const fields = "files(id,name,webViewLink,modifiedTime,size)";
  const r = await fetch(`${DRIVE_FILES_URL}?q=${q}&pageSize=1&fields=${encodeURIComponent(fields)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = await r.json();
  if (!r.ok) throw new Error("find_failed: " + JSON.stringify(j));
  return j.files && j.files[0] ? j.files[0] : null;
}

async function downloadText(env, fileId) {
  const token = await getAccessToken(env);
  const r = await fetch(`${DRIVE_FILES_URL}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("download_failed: " + (await r.text()));
  return await r.text();
}

async function createTextFile(env, name, content) {
  const token = await getAccessToken(env);
  const folderId = ensureFolder(env);
  const boundary = "----senti-drive-" + Math.random().toString(16).slice(2);
  const metadata = { name, parents: [folderId], mimeType: "text/plain" };

  const enc = new TextEncoder();
  const body = new Blob([
    enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    enc.encode(`--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${content}\r\n`),
    enc.encode(`--${boundary}--\r\n`),
  ]);

  const r = await fetch(DRIVE_UPLOAD_MULTIPART, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const j = await r.json();
  if (!r.ok) throw new Error("create_failed: " + JSON.stringify(j));
  return j;
}

async function updateTextFile(env, fileId, content) {
  const token = await getAccessToken(env);
  const boundary = "----senti-drive-" + Math.random().toString(16).slice(2);
  const metadata = { mimeType: "text/plain" };

  const enc = new TextEncoder();
  const body = new Blob([
    enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    enc.encode(`--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${content}\r\n`),
    enc.encode(`--${boundary}--\r\n`),
  ]);

  const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const j = await r.json();
  if (!r.ok) throw new Error("update_failed: " + JSON.stringify(j));
  return j;
}

export async function driveAppendLog(env, filename, line) {
  const name = filename || "senti_logs.txt";
  const ts = new Date().toISOString();
  const entry = `[${ts}] ${line}\n`;

  const existing = await findFileByName(env, name);

  if (!existing) {
    const created = await createTextFile(env, name, entry);
    return { action: "created", id: created.id, name, webViewLink: `https://drive.google.com/file/d/${created.id}/view` };
  }

  let prev = await downloadText(env, existing.id);
  if (prev.length > 1024 * 1024) {
    prev = prev.slice(-1024 * 1024);
  }
  const updated = await updateTextFile(env, existing.id, prev + entry);
  return { action: "appended", id: updated.id, name, webViewLink: `https://drive.google.com/file/d/${updated.id}/view` };
}