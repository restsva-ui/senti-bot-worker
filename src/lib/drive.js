// src/lib/drive.js
// Google Drive для Cloudflare Workers:
// 1) OAuth (user) токен із OAUTH_KV/google_oauth_token  ← пріоритет
// 2) Фолбек: Service Account (JWT)
// Завантаження йде у вихідному форматі (mime з джерела).
// + Утиліти для читання/перезапису текстових файлів за назвою (для чекліста).

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_UPLOAD_MULTIPART = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";

// ---------- Utils ----------
function ensureFolder(env) {
  const id = env.DRIVE_FOLDER_ID;
  if (!id) throw new Error("Missing DRIVE_FOLDER_ID");
  return id;
}

function guessExtFromMime(m) {
  if (!m) return "";
  const map = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "audio/mpeg": ".mp3",
    "text/plain": ".txt",
    "application/pdf": ".pdf",
    "application/zip": ".zip",
    "application/octet-stream": "",
  };
  return map[m] ?? "";
}

function nameWithExt(name, mime) {
  if (!name) return "";
  const hasExt = /\.[a-z0-9]{2,7}$/i.test(name);
  return hasExt ? name : name + guessExtFromMime(mime);
}

function guessNameFromUrl(u) {
  try {
    const url = new URL(u);
    const last = url.pathname.split("/").pop() || "file";
    return last;
  } catch {
    return "file";
  }
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
function pemToArrayBuffer(pem) {
  const raw = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(raw);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

// ---------- OAuth (KV) ----------
const OAUTH_KV_KEY = "google_oauth_token";

async function readOAuth(env) {
  try {
    const raw = await env.OAUTH_KV.get(OAUTH_KV_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function saveOAuth(env, obj) {
  try {
    await env.OAUTH_KV.put(OAUTH_KV_KEY, JSON.stringify(obj));
  } catch (_) {}
}

async function maybeRefreshOAuth(env, tok) {
  try {
    const savedAt = tok.saved_at ?? 0;
    const expSec = tok.expires_in ?? 3600;
    const stillValid = Date.now() < (savedAt + (expSec * 1000)) - 60_000;
    if (stillValid) return tok.access_token;

    const cid = env.GOOGLE_CLIENT_ID;
    const cs = env.GOOGLE_CLIENT_SECRET;
    const rt = tok.refresh_token;
    if (!cid || !cs || !rt) return tok.access_token;

    const resp = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: cid,
        client_secret: cs,
        refresh_token: rt,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error("refresh_failed: " + JSON.stringify(data));

    const merged = {
      ...tok,
      ...data,
      saved_at: Date.now(),
      refresh_token: tok.refresh_token || data.refresh_token,
    };
    await saveOAuth(env, merged);
    return merged.access_token;
  } catch {
    return tok.access_token;
  }
}

// ---------- Service Account (JWT) ----------
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

async function getSAToken(env) {
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

// ---------- Unified access token ----------
async function getAccessToken(env) {
  if (env.OAUTH_KV) {
    const tok = await readOAuth(env);
    if (tok && tok.access_token) {
      return await maybeRefreshOAuth(env, tok);
    }
  }
  return await getSAToken(env);
}

// ---------- API ----------
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

export async function driveSaveFromUrl(env, fileUrl, nameOptional) {
  const token = await getAccessToken(env);
  const folderId = ensureFolder(env);

  const src = await fetch(fileUrl);
  if (!src.ok) throw new Error(`Fetch failed: ${src.status}`);
  const buf = new Uint8Array(await src.arrayBuffer());
  const mime = (src.headers.get("content-type") || "").split(";")[0].trim() || "application/octet-stream";

  const baseName = (nameOptional && nameOptional.trim()) || guessNameFromUrl(fileUrl);
  const filename = nameWithExt(baseName, mime);

  const boundary = "----senti-drive-" + Math.random().toString(16).slice(2);
  const metadata = { name: filename, parents: [folderId], mimeType: mime };

  const enc = new TextEncoder();
  const body = new Blob([
    enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    enc.encode(`--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
    buf,
    enc.encode(`\r\n--${boundary}--\r\n`),
  ]);

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

// --------- ТЕКСТОВІ ОПЕРАЦІЇ (для чекліста) ----------
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
  const metadata = { name, parents: [folderId], mimeType: "text/markdown" };

  const enc = new TextEncoder();
  const body = new Blob([
    enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    enc.encode(`--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${content}\r\n`),
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
  const metadata = { mimeType: "text/markdown" };

  const enc = new TextEncoder();
  const body = new Blob([
    enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    enc.encode(`--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${content}\r\n`),
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
  const name = filename || "senti_checklist.md";
  const ts = new Date().toISOString();
  const entry = `- [${ts}] ${line}\n`;

  const existing = await findFileByName(env, name);
  if (!existing) {
    const created = await createTextFile(env, name, entry);
    return { action: "created", id: created.id, name, webViewLink: `https://drive.google.com/file/d/${created.id}/view` };
  }

  let prev = await downloadText(env, existing.id);
  if (prev.length > 1024 * 1024) prev = prev.slice(-1024 * 1024);
  const updated = await updateTextFile(env, existing.id, prev + entry);
  return { action: "appended", id: updated.id, name, webViewLink: `https://drive.google.com/file/d/${updated.id}/view` };
}

// === Експорти для чекліста ===
export async function driveReadTextByName(env, name) {
  const existing = await findFileByName(env, name);
  if (!existing) return "";
  return await downloadText(env, existing.id);
}

export async function driveSetTextByName(env, name, content) {
  const existing = await findFileByName(env, name);
  if (!existing) {
    const created = await createTextFile(env, name, content);
    return { created: true, id: created.id };
  }
  const updated = await updateTextFile(env, existing.id, content);
  return { created: false, id: updated.id };
}