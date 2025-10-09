// src/lib/drive.js
// Drive via Service Account (пріоритет) + fallback на OAuth refresh.
// Без atob по env-секретах. Сумісно зі старими викликами.

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const OAUTH_KEY = "google_oauth";

// ---------- helpers ----------
const nowSec = () => Math.floor(Date.now() / 1000);
const textEncoder = new TextEncoder();

function ensureKv(env) {
  if (!env.OAUTH_KV) throw new Error("OAUTH_KV binding missing");
  return env.OAUTH_KV;
}
async function readKvTokens(env) {
  try {
    const raw = await ensureKv(env).get(OAUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
async function writeKvTokens(env, data) {
  const kv = ensureKv(env);
  await kv.delete(OAUTH_KEY).catch(()=>{});
  await kv.put(OAUTH_KEY, JSON.stringify(data));
}

function getFolderId(env) {
  const v = (env.DRIVE_FOLDER_ID || "").trim();
  if (v && v !== "." && v.toLowerCase() !== "root") return v;
  return "root";
}

// ---------- Service Account JSON (RAW) ----------
function readServiceAccount(env) {
  const raw = env.DRIVE_SERVICE_ACCOUNT;
  if (!raw) return null;
  // Очікуємо ЧИСТИЙ JSON (не base64)
  try {
    const j = JSON.parse(raw);
    if (!j.client_email || !j.private_key) {
      throw new Error("Service account JSON missing fields");
    }
    return j;
  } catch (e) {
    throw new Error("DRIVE_SERVICE_ACCOUNT must be raw JSON (paste file contents)");
  }
}

// ---------- JWT (RS256) для Service Account ----------
function pemToPkcs8DER(pem) {
  const b64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  // Це валідний base64 з PEM
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function importPrivateKeyRS256(pem) {
  const der = pemToPkcs8DER(pem);
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

function base64url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  let b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signJwtRS256(headerObj, payloadObj, privateKey) {
  const header = base64url(textEncoder.encode(JSON.stringify(headerObj)));
  const payload = base64url(textEncoder.encode(JSON.stringify(payloadObj)));
  const data = header + "." + payload;
  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    textEncoder.encode(data)
  );
  const signature = base64url(new Uint8Array(sigBuf));
  return `${data}.${signature}`;
}

async function getServiceAccessToken(env) {
  const sa = readServiceAccount(env);
  if (!sa) return null;

  const iat = nowSec();
  const exp = iat + 3600; // 1h
  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";

  const key = await importPrivateKeyRS256(sa.private_key);

  const jwt = await signJwtRS256(
    { alg: "RS256", typ: "JWT" },
    {
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/drive",
      aud: tokenUri,
      exp,
      iat
      // sub: <email> // не потрібно для спільної папки, якщо SA має доступ
    },
    key
  );

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt
  });

  const r = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  let d = {};
  try { d = await r.json(); } catch {}
  if (!r.ok || !d.access_token) {
    throw new Error(`Service token exchange failed ${r.status}: ${JSON.stringify(d)}`);
  }

  return {
    access_token: d.access_token,
    expiry: nowSec() + (d.expires_in || 3600) - 60
  };
}

// ---------- Старий шлях: refresh_token ----------
async function refreshAccessToken(env, refreshToken) {
  if (!refreshToken) throw new Error("refreshAccessToken: refreshToken missing");
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  let d = {};
  try { d = await r.json(); } catch {}
  if (!r.ok || !d.access_token) {
    throw new Error(`Refresh ${r.status}: ${JSON.stringify(d)}`);
  }
  return {
    access_token: d.access_token,
    refresh_token: refreshToken,
    expiry: nowSec() + (d.expires_in || 3600) - 60
  };
}

// ---------- Публічний токен-брідж ----------
export async function getAccessToken(env) {
  // 1) Пробуємо Service Account (без KV і без base64)
  if (env.DRIVE_SERVICE_ACCOUNT) {
    const tok = await getServiceAccessToken(env);
    return tok.access_token;
  }

  // 2) KV кеш (старий шлях)
  const kv = await readKvTokens(env);
  if (kv?.access_token && kv.expiry > nowSec() + 10) return kv.access_token;
  if (kv?.refresh_token) {
    const next = await refreshAccessToken(env, kv.refresh_token);
    await writeKvTokens(env, next);
    return next.access_token;
  }

  // 3) ENV refresh_token (старий шлях)
  if (env.GOOGLE_REFRESH_TOKEN) {
    const next = await refreshAccessToken(env, env.GOOGLE_REFRESH_TOKEN);
    await writeKvTokens(env, next);
    return next.access_token;
  }

  throw new Error("Google Drive auth missing — add DRIVE_SERVICE_ACCOUNT or GOOGLE_REFRESH_TOKEN");
}

// ---------- Admin прямий (для перевірки) ----------
export async function directAdminAccessToken(env) {
  if (env.DRIVE_SERVICE_ACCOUNT) {
    const t = await getServiceAccessToken(env);
    return t.access_token;
  }
  // fallback
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: env.GOOGLE_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const d = await r.json().catch(()=>({}));
  if (!r.ok || !d.access_token) {
    throw new Error(`Admin refresh ${r.status}: ${JSON.stringify(d)}`);
  }
  return d.access_token;
}

// ---------- Drive ops ----------
export async function listFiles(env, token) {
  const fid = getFolderId(env);
  const url = new URL(`${DRIVE_API}/files`);
  url.searchParams.set("q", `'${fid}' in parents and trashed=false`);
  url.searchParams.set("fields", "files(id,name,modifiedTime)");
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) throw new Error(`List ${r.status}: ${await r.text().catch(()=> "")}`);
  return r.json();
}

export async function ensureChecklist(env, token) {
  const fid = getFolderId(env);
  const q = `name='senti_checklist.md' and '${fid}' in parents and trashed=false`;
  const search = await fetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const j = await search.json().catch(()=> ({}));
  if (j.files?.[0]) return j.files[0].id;

  const meta = { name: "senti_checklist.md", parents: [fid], mimeType: "text/markdown" };
  const body =
    `--x\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--x\r\n` +
    `Content-Type: text/markdown\r\n\r\n# Senti checklist\n\r\n--x--`;

  const r = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "multipart/related; boundary=x",
    },
    body
  });
  const d = await r.json().catch(()=> ({}));
  if (!r.ok) throw new Error(`Create checklist ${r.status}: ${JSON.stringify(d)}`);
  return d.id;
}

export async function appendToChecklist(env, token, line) {
  const id = await ensureChecklist(env, token);
  const cur = await fetch(`${DRIVE_API}/files/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const txt = cur.ok ? await cur.text() : "# Senti checklist\n";
  const body = (txt || "# Senti checklist\n") + `- ${line}\n`;

  const r = await fetch(`${UPLOAD_API}/files/${id}?uploadType=media`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/markdown",
    },
    body
  });
  if (!r.ok) throw new Error(`Update ${r.status}: ${await r.text().catch(()=> "")}`);
  return true;
}

export async function saveUrlToDrive(env, token, fileUrl, name) {
  const fid = getFolderId(env);
  const f = await fetch(fileUrl);
  if (!f.ok) throw new Error(`Завантаження URL: ${f.status}`);
  const buf = await f.arrayBuffer();

  const meta = { name, parents: [fid] };
  const head =
    `--x\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--x\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`;
  const full = new Blob([head, new Uint8Array(buf), "\r\n--x--"]);

  const r = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "multipart/related; boundary=x",
    },
    body: full,
  });
  const j = await r.json().catch(()=> ({}));
  if (!r.ok) throw new Error(`Upload ${r.status}: ${JSON.stringify(j)}`);
  return j;
}

// ---------- старі назви для сумісності ----------
export async function drivePing(env, tokenOpt) {
  const token = tokenOpt || (await getAccessToken(env));
  const files = await listFiles(env, token);
  return { ok: true, filesCount: files.files?.length || 0 };
}
export async function driveList(env, tokenOpt) {
  const token = tokenOpt || (await getAccessToken(env));
  return listFiles(env, token);
}
export const driveListLatest = listFiles;
export const driveSaveFromUrl = saveUrlToDrive;
export const driveAppendLog = appendToChecklist;