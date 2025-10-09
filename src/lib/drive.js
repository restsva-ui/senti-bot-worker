// src/lib/drive.js
// Повна стабільна версія з фіксом ENV refresh, адмін-режимом без кешу, сумісністю та безпечними помилками.
// + Фікс ReferenceError refresh_token not defined
// + ДОДАНО: підтримка Service Account (DRIVE_SERVICE_ACCOUNT або GOOGLE_DRIVE_CREDENTIALS) з JWT та кешуванням у KV.

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const OAUTH_KEY = "google_oauth";          // кеш user/refresh або SA токена
const SA_SCOPE  = "https://www.googleapis.com/auth/drive";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// ---------- Утиліти ----------
function nowSec() {
  return Math.floor(Date.now() / 1000);
}
function b64url(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/,"");
}
function jsonB64url(obj) { return b64url(JSON.stringify(obj)); }

// ---------- KV токени ----------
function ensureKv(env) {
  if (!env.OAUTH_KV) {
    throw new Error(
      "OAUTH_KV binding missing — додай [[kv_namespaces]] binding у wrangler.toml і зроби деплой"
    );
  }
  return env.OAUTH_KV;
}

async function readKvTokens(env) {
  const kv = ensureKv(env);
  const raw = await kv.get(OAUTH_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeKvTokens(env, data) {
  const kv = ensureKv(env);
  await kv.delete(OAUTH_KEY).catch(() => {});
  await kv.put(OAUTH_KEY, JSON.stringify(data));
}

// ---------- Service Account helpers ----------
function pickServiceAccount(env) {
  const raw = (env.DRIVE_SERVICE_ACCOUNT || env.GOOGLE_DRIVE_CREDENTIALS || "").trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/,"").replace(/-----END PRIVATE KEY-----/,"").replace(/\s+/g,"");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i=0; i<bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function saJWT(env, sa, scope = SA_SCOPE) {
  const now = Math.floor(Date.now()/1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimset = {
    iss: sa.client_email,
    scope,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now
  };
  const toSign = `${jsonB64url(header)}.${jsonB64url(claimset)}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(toSign));
  const signature = b64url(String.fromCharCode(...new Uint8Array(sig)));
  return `${toSign}.${signature}`;
}

async function exchangeJWT(jwt) {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  let d = {};
  try { d = await r.json(); } catch {}
  if (!r.ok || !d.access_token) {
    throw new Error(`Service token exchange failed ${r.status}: ${JSON.stringify(d)}`);
  }
  return { access_token: d.access_token, expiry: nowSec() + (d.expires_in || 3600) - 30 };
}

// ---------- Отримання access_token (з пріоритетом Service Account) ----------
export async function getAccessToken(env) {
  // 0) Якщо в KV лежить свіже — повертаємо (для SA або refresh однаково)
  const cached = await readKvTokens(env);
  if (cached?.access_token && cached.expiry > nowSec() + 10) return cached.access_token;

  // 1) Service Account, якщо налаштовано
  const sa = pickServiceAccount(env);
  if (sa) {
    const jwt = await saJWT(env, sa);
    const token = await exchangeJWT(jwt);
    await writeKvTokens(env, { ...token, mode: "sa" });
    return token.access_token;
  }

  // 2) User OAuth: якщо є refresh у KV — рефрешимо
  if (cached?.refresh_token) {
    const next = await refreshAccessToken(env, cached.refresh_token);
    await writeKvTokens(env, next);
    return next.access_token;
  }

  // 3) Fallback: рефреш із ENV
  if (env.GOOGLE_REFRESH_TOKEN) {
    const next = await refreshAccessToken(env, env.GOOGLE_REFRESH_TOKEN);
    await writeKvTokens(env, next);
    return next.access_token;
  }

  throw new Error("Google Drive auth missing — пройди авторизацію /auth або додай DRIVE_SERVICE_ACCOUNT");
}

// ---------- Прямий refresh без кешу для адмін-діагностики ----------
export async function directAdminAccessToken(env) {
  if (pickServiceAccount(env)) {
    // якщо є SA — повертай одразу SA токен без кешу
    const jwt = await saJWT(env, pickServiceAccount(env));
    const token = await exchangeJWT(jwt);
    return token.access_token;
  }
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: env.GOOGLE_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    throw new Error(`Admin refresh ${r.status}: ${JSON.stringify(d)}`);
  }
  return d.access_token;
}

// ---------- Основна функція refresh з фіксом ----------
async function refreshAccessToken(env, refreshToken) {
  if (!refreshToken || typeof refreshToken !== "string") {
    throw new Error("refreshAccessToken: refreshToken відсутній або невалідний");
  }

  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  let d = {};
  try {
    d = await r.json();
  } catch {
    throw new Error(`Refresh parse error ${r.status}`);
  }

  if (!r.ok || !d.access_token) {
    throw new Error(`Refresh ${r.status}: ${JSON.stringify(d)}`);
  }

  return {
    access_token: d.access_token,
    refresh_token: refreshToken, // ← фіксовано правильне ім’я змінної
    expiry: Math.floor(Date.now() / 1000) + (d.expires_in || 3600) - 60,
  };
}

// ---------- Вибір папки ----------
function getFolderId(env) {
  const raw = (env.DRIVE_FOLDER_ID || "").trim();
  if (raw && raw !== "." && raw.toLowerCase() !== "root") return raw;
  return "root";
}

function authHeaders(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

// ---------- Основні операції ----------
export async function listFiles(env, token) {
  const fid = getFolderId(env);
  const url = new URL(`${DRIVE_API}/files`);
  url.searchParams.set("q", `'${fid}' in parents and trashed=false`);
  url.searchParams.set("fields", "files(id,name,modifiedTime)");
  const r = await fetch(url, { headers: authHeaders(token) });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`List ${r.status}: ${t}`);
  }
  return r.json();
}

export async function appendToChecklist(env, token, line) {
  const id = await ensureChecklist(env, token);
  const get = await fetch(`${DRIVE_API}/files/${id}?alt=media`, {
    headers: authHeaders(token),
  });
  let txt = "";
  if (get.ok) txt = await get.text();
  const body = (txt || "# Senti checklist\n") + `- ${line}\n`;
  const r = await fetch(`${UPLOAD_API}/files/${id}?uploadType=media`, {
    method: "PATCH",
    headers: authHeaders(token, { "Content-Type": "text/markdown" }),
    body,
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Update ${r.status}: ${t}`);
  }
  return true;
}

export async function ensureChecklist(env, token) {
  const fid = getFolderId(env);
  const q = `name='senti_checklist.md' and '${fid}' in parents and trashed=false`;
  const search = await fetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id)`,
    { headers: authHeaders(token) }
  );
  const j = await search.json();
  if (j.files?.[0]) return j.files[0].id;

  const meta = { name: "senti_checklist.md", parents: [fid], mimeType: "text/markdown" };
  const body =
    `--x\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--x\r\n` +
    `Content-Type: text/markdown\r\n\r\n# Senti checklist\n\r\n--x--`;

  const r = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "multipart/related; boundary=x" }),
    body,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Create checklist ${r.status}: ${JSON.stringify(d)}`);
  return d.id;
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
    headers: authHeaders(token, { "Content-Type": "multipart/related; boundary=x" }),
    body: full,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Upload ${r.status}: ${JSON.stringify(j)}`);
  return j;
}

// ---------- Старі alias-експорти ----------
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