// src/lib/drive.js
// Google Drive клієнт для Cloudflare Workers: User OAuth (пріоритет) + fallback Service Account (JWT)

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_UPLOAD_MULTIPART = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";

// ---- KV ключі (пробуємо кілька варіантів, щоб бути сумісними з попередніми кроками) ----
const KV_KEYS = ["oauth_google_drive", "google_oauth_token"];

/* =========================
 *  Helpers: KV (user tokens)
 * ========================= */
async function kvGetUserTokens(env) {
  if (!env.OAUTH_KV) return null;
  for (const key of KV_KEYS) {
    try {
      const obj = await env.OAUTH_KV.get(key, { type: "json" });
      if (obj && typeof obj === "object") return { key, obj };
    } catch (_) {}
  }
  return null;
}

async function kvPutUserTokens(env, key, obj) {
  if (!env.OAUTH_KV) return;
  await env.OAUTH_KV.put(key, JSON.stringify(obj));
}

/* =========================
 *  User OAuth access token
 * ========================= */
function approxNow() {
  return Math.floor(Date.now() / 1000);
}

function isAccessExpired(tok) {
  if (!tok || !tok.expires_in || !tok.saved_at) return true;
  const now = approxNow();
  // невеликий буфер 60с
  return tok.saved_at + tok.expires_in - 60 <= now;
}

async function refreshUserAccessToken(env, stored) {
  // потребує GOOGLE_CLIENT_ID та GOOGLE_CLIENT_SECRET
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET for refresh");

  const refreshToken = stored?.obj?.refresh_token;
  if (!refreshToken) throw new Error("No refresh_token in KV");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const r = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = await r.json();
  if (!r.ok) throw new Error("refresh_failed: " + JSON.stringify(j));

  const updated = {
    // Google може не повертати refresh_token під час refresh — зберігаємо старий
    access_token: j.access_token,
    expires_in: j.expires_in,
    token_type: j.token_type || "Bearer",
    scope: j.scope || stored.obj.scope,
    refresh_token: j.refresh_token || refreshToken,
    refresh_token_expires_in: j.refresh_token_expires_in || stored.obj.refresh_token_expires_in,
    saved_at: Date.now() / 1000,
  };
  await kvPutUserTokens(env, stored.key, updated);
  return updated;
}

async function getUserAccessTokenIfAny(env) {
  const stored = await kvGetUserTokens(env);
  if (!stored) return null;

  let obj = stored.obj;
  if (!obj?.access_token || isAccessExpired(obj)) {
    try {
      obj = await refreshUserAccessToken(env, stored);
    } catch (e) {
      // якщо не вдалося — повернемо null, хай спрацює fallback
      return null;
    }
  }
  return obj?.access_token || null;
}

/* ======================================
 *  Service Account (JWT) — fallback path
 * ====================================== */
function getCreds(env) {
  if (!env.GOOGLE_DRIVE_CREDENTIALS) throw new Error("Missing secret GOOGLE_DRIVE_CREDENTIALS");
  try {
    const creds = JSON.parse(env.GOOGLE_DRIVE_CREDENTIALS);
    if (!creds.client_email || !creds.private_key) throw new Error();
    return creds;
  } catch {
    throw new Error("GOOGLE_DRIVE_CREDENTIALS must include client_email and private_key (valid JSON)");
  }
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

async function getServiceAccountAccessToken(env) {
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

/* =========================
 *  Unified token provider
 * ========================= */
async function getDriveAccessToken(env) {
  // 1) пробуємо user OAuth
  const userTok = await getUserAccessTokenIfAny(env);
  if (userTok) return userTok;
  // 2) fallback — Service Account
  return await getServiceAccountAccessToken(env);
}

/* =========================
 *  Misc helpers
 * ========================= */
function ensureFolder(env) {
  const id = env.DRIVE_FOLDER_ID;
  if (!id) throw new Error("Missing DRIVE_FOLDER_ID (Cloudflare Variable)");
  return id;
}

function guessNameFromUrl(u) {
  try {
    const url = new URL(u);
    const last = url.pathname.split("/").pop() || "file";
    return last.includes(".") ? last : last + ".bin";
  } catch {
    return "file.bin";
  }
}

/* =========================
 *  Public API
 * ========================= */
export async function drivePing(env) {
  const token = await getDriveAccessToken(env);
  const folderId = ensureFolder(env);
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await fetch(`${DRIVE_FILES_URL}?q=${q}&pageSize=1&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Drive ping failed: " + (await res.text()));
  return true;
}

// --------- базові завантаження ----------
export async function driveSaveFromUrl(env, fileUrl, nameOptional) {
  const token = await getDriveAccessToken(env);
  const folderId = ensureFolder(env);

  const src = await fetch(fileUrl);
  if (!src.ok) throw new Error(`Fetch failed: ${src.status}`);
  const buf = new Uint8Array(await src.arrayBuffer());

  const filename = (nameOptional && nameOptional.trim()) || guessNameFromUrl(fileUrl);
  const boundary = "----senti-drive-" + Math.random().toString(16).slice(2);
  const metadata = { name: filename, parents: [folderId] };

  const enc = new TextEncoder();
  const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
  const filePartHeader = `--${boundary}\r\nContent-Type: application/zip\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;

  const body = new Blob([enc.encode(metaPart), enc.encode(filePartHeader), buf, enc.encode(footer)]);

  const upload = await fetch(DRIVE_UPLOAD_MULTIPART, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const info = await upload.json();
  if (!upload.ok) throw new Error("upload_failed: " + JSON.stringify(info));

  return { id: info.id, name: info.name, link: `https://drive.google.com/file/d/${info.id}/view` };
}

export async function driveList(env, limit = 10) {
  const token = await getDriveAccessToken(env);
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
  const token = await getDriveAccessToken(env);
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
  const token = await getDriveAccessToken(env);
  const r = await fetch(`${DRIVE_FILES_URL}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("download_failed: " + (await r.text()));
  return await r.text();
}

async function createTextFile(env, name, content) {
  const token = await getDriveAccessToken(env);
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
  const token = await getDriveAccessToken(env);
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