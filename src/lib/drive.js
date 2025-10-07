// src/lib/drive.js
// Повна версія з фіксом папки: "." ніколи не використовується — лише 'root' або DRIVE_FOLDER_ID

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const OAUTH_KEY = "google_oauth"; // ключ у OAUTH_KV

// ===================== OAuth =====================

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

// Отримати токени з KV (якщо є)
async function readKvTokens(env) {
  if (!env.OAUTH_KV) return null;
  const raw = await env.OAUTH_KV.get(OAUTH_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Зберегти токени в KV
async function writeKvTokens(env, data) {
  if (!env.OAUTH_KV) return;
  await env.OAUTH_KV.put(OAUTH_KEY, JSON.stringify(data));
}

// Обмін authorization code -> токени (викликається з роуту /oauth2/callback)
export async function exchangeCodeForTokens(env, code, redirectUri) {
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await r.json();
  if (!r.ok) {
    throw new Error(`OAuth code exchange ${r.status}: ${JSON.stringify(data)}`);
  }
  // Очікуємо access_token + refresh_token
  const rec = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || env.GOOGLE_REFRESH_TOKEN || null,
    scope: data.scope,
    token_type: data.token_type,
    expiry: nowSec() + (data.expires_in || 3600) - 60
  };
  await writeKvTokens(env, rec);
  return rec;
}

// Оновити access token за refresh_token
async function refreshAccessToken(env, refreshToken) {
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await r.json();
  if (!r.ok) {
    throw new Error(`OAuth refresh ${r.status}: ${JSON.stringify(data)}`);
  }
  return {
    access_token: data.access_token,
    refresh_token: refreshToken,
    scope: data.scope,
    token_type: data.token_type,
    expiry: nowSec() + (data.expires_in || 3600) - 60
  };
}

// Публічний метод для роута /panel щоб побудувати URL авторизації
export function buildUserConsentUrl(env, redirectUri) {
  // Даємо повний доступ до Drive, щоб бачити існуючі папки/файли
  const scope = encodeURIComponent("https://www.googleapis.com/auth/drive");
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    scope
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// Скидання токенів (на випадок перевидачі прав)
export async function resetTokens(env) {
  if (env.OAUTH_KV) await env.OAUTH_KV.delete(OAUTH_KEY);
  return true;
}

// Отримати робочий access_token з таких джерел:
// 1) KV (і за потреби рефреш)
// 2) GOOGLE_REFRESH_TOKEN з env
export async function getAccessToken(env) {
  // 1) KV
  const kv = await readKvTokens(env);
  if (kv?.access_token && kv?.expiry && kv.expiry > nowSec() + 15) {
    return kv.access_token;
  }
  if (kv?.refresh_token) {
    const next = await refreshAccessToken(env, kv.refresh_token);
    await writeKvTokens(env, next);
    return next.access_token;
  }
  // 2) Еnv refresh_token
  if (env.GOOGLE_REFRESH_TOKEN && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    const next = await refreshAccessToken(env, env.GOOGLE_REFRESH_TOKEN);
    await writeKvTokens(env, next); // кешуємо для майбутнього
    return next.access_token;
  }
  throw new Error("Google Drive auth is not configured (no tokens).");
}

// ===================== Папка (ФІКС) =====================

// Беремо батьківську папку: або валідний DRIVE_FOLDER_ID, або 'root'.
// НІКОЛИ не повертаємо "."
function getFolderId(env) {
  const raw = (env.DRIVE_FOLDER_ID || "").trim();
  if (raw && raw !== "." && raw.toLowerCase() !== "root") return raw;
  return "root";
}

// ===================== Операції Drive =====================

export async function listFiles(env, accessToken) {
  const folderId = getFolderId(env);
  const url = new URL(`${DRIVE_API}/files`);
  url.searchParams.set("q", `'${folderId}' in parents and trashed=false`);
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set("fields", "files(id,name,modifiedTime,size,mimeType)");
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`List ${r.status}: ${t}`);
  }
  return r.json();
}

export async function ensureChecklist(env, accessToken) {
  const folderId = getFolderId(env);
  const name = "senti_checklist.md";

  // Пошук у конкретній папці
  const q = `name='${name.replaceAll("'", "\\'")}' and '${folderId}' in parents and trashed=false`;
  const search = new URL(`${DRIVE_API}/files`);
  search.searchParams.set("q", q);
  search.searchParams.set("fields", "files(id,name)");
  const s = await fetch(search, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await s.json();
  if (!s.ok) throw new Error(`Search ${s.status}: ${JSON.stringify(data)}`);
  if (data.files && data.files[0]?.id) return data.files[0].id;

  // Створюємо
  const meta = { name, parents: [folderId], mimeType: "text/markdown" };
  const boundary = "xSENTI" + Math.random().toString(36).slice(2);
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(meta) +
    `\r\n--${boundary}\r\n` +
    `Content-Type: text/markdown\r\n\r\n` +
    `# Senti checklist\n` +
    `\r\n--${boundary}--`;

  const r = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Create checklist ${r.status}: ${t}`);
  }
  const created = await r.json();
  return created.id;
}

export async function appendToChecklist(env, accessToken, line) {
  const fileId = await ensureChecklist(env, accessToken);

  // 1) читаємо
  const getUrl = new URL(`${DRIVE_API}/files/${fileId}`);
  getUrl.searchParams.set("alt", "media");
  const gr = await fetch(getUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  let current = "";
  if (gr.ok) current = await gr.text();
  const next = (current || "# Senti checklist\n") + `- ${line}\n`;

  // 2) оновлюємо
  const ur = await fetch(`${UPLOAD_API}/files/${fileId}?uploadType=media`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "text/markdown"
    },
    body: next
  });
  if (!ur.ok) {
    const t = await ur.text().catch(() => "");
    throw new Error(`Update checklist ${ur.status}: ${t}`);
  }
  return true;
}

export async function saveUrlToDrive(env, accessToken, fileUrl, name) {
  const folderId = getFolderId(env);

  // 1) забираємо контент
  const fr = await fetch(fileUrl);
  if (!fr.ok) throw new Error(`Завантаження URL: ${fr.status} ${fr.statusText}`);
  const buf = await fr.arrayBuffer();

  // 2) multipart upload із parents
  const meta = { name, parents: [folderId] };
  const boundary = "xSENTI" + Math.random().toString(36).slice(2);
  const head =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(meta) +
    `\r\n--${boundary}\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = new Blob([head, new Uint8Array(buf), tail]);

  const r = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Upload ${r.status}: ${t}`);
  }
  return r.json();
}

// Утиліта для зовнішніх роутів
export async function withDrive(env, fn) {
  const token = await getAccessToken(env);
  return fn(token);
}