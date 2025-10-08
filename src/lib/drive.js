// src/lib/drive.js
// Повна версія з фіксом папки, автосіданням refresh-токена з секретів
// і підтримкою старих/нових імпортів (функції + клас Drive)

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const OAUTH_KEY = "google_oauth";

/* ======================== Утиліти ======================== */
function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/* ==================== Робота з KV токенами ==================== */
async function readKvTokens(env) {
  if (!env.OAUTH_KV) return null;
  const raw = await env.OAUTH_KV.get(OAUTH_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function writeKvTokens(env, data) {
  if (!env.OAUTH_KV) return;
  await env.OAUTH_KV.put(OAUTH_KEY, JSON.stringify(data));
}

/** Якщо в секретах є GOOGLE_REFRESH_TOKEN і в KV пусто — засіяти його */
async function seedRefreshFromEnvIfNeeded(env) {
  const existing = await readKvTokens(env);
  if (existing?.refresh_token) return existing;

  const rt = (env.GOOGLE_REFRESH_TOKEN || "").trim();
  if (!rt) return existing; // нема чого сіяти

  const seeded = { refresh_token: rt, access_token: "", expiry: 0 };
  await writeKvTokens(env, seeded);
  return seeded;
}

/* ==================== OAuth: отримання токена ==================== */
async function refreshAccessToken(env, refreshToken) {
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const d = await r.json();
  if (!r.ok) throw new Error(`Refresh ${r.status}: ${JSON.stringify(d)}`);

  return {
    access_token: d.access_token,
    refresh_token: refreshToken,
    expiry: nowSec() + (d.expires_in || 3600) - 60,
  };
}

export async function getAccessToken(env) {
  // 1) спробувати прочитати/засіяти KV
  let kv = await readKvTokens(env);
  if (!kv) kv = await seedRefreshFromEnvIfNeeded(env);

  // 2) є валідний access_token?
  if (kv?.access_token && kv.expiry > nowSec() + 10) return kv.access_token;

  // 3) пробуємо оновити через refresh_token
  const rt = kv?.refresh_token || (env.GOOGLE_REFRESH_TOKEN || "").trim();
  if (rt) {
    const next = await refreshAccessToken(env, rt);
    await writeKvTokens(env, next);
    return next.access_token;
  }

  throw new Error("Google Drive auth missing");
}

/* ==================== Фікс вибору цільової папки ==================== */
function getFolderId(env) {
  const raw = (env.DRIVE_FOLDER_ID || "").trim();
  if (raw && raw !== "." && raw.toLowerCase() !== "root") return raw;
  return "root";
}

/* ==================== Основні операції з Drive ==================== */
export async function listFiles(env, token) {
  const at = token || (await getAccessToken(env));
  const fid = getFolderId(env);

  const url = new URL(`${DRIVE_API}/files`);
  url.searchParams.set("q", `'${fid}' in parents and trashed=false`);
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set("fields", "files(id,name,modifiedTime)");

  const r = await fetch(url, { headers: { Authorization: `Bearer ${at}` } });
  if (!r.ok) throw new Error(`List ${r.status}`);
  return r.json();
}

export async function ensureChecklist(env, token) {
  const at = token || (await getAccessToken(env));
  const fid = getFolderId(env);
  const q = `name='senti_checklist.md' and '${fid}' in parents and trashed=false`;

  const search = await fetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${at}` } }
  );

  const j = await search.json();
  if (j.files?.[0]) return j.files[0].id;

  const meta = { name: "senti_checklist.md", parents: [fid], mimeType: "text/markdown" };
  const body =
    `--x\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--x\r\n` +
    `Content-Type: text/markdown\r\n\r\n# Senti checklist\n\r\n--x--`;

  const r = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${at}`,
      "Content-Type": "multipart/related; boundary=x",
    },
    body,
  });

  const d = await r.json();
  if (!r.ok) throw new Error(`Create checklist ${r.status}`);
  return d.id;
}

export async function appendToChecklist(env, token, line) {
  const at = token || (await getAccessToken(env));
  const id = await ensureChecklist(env, at);

  // поточний вміст
  let txt = "";
  const get = await fetch(`${DRIVE_API}/files/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${at}` },
  });
  if (get.ok) txt = await get.text();

  // дописуємо
  const body = (txt || "# Senti checklist\n") + `- ${line}\n`;
  const r = await fetch(`${UPLOAD_API}/files/${id}?uploadType=media`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${at}`,
      "Content-Type": "text/markdown",
    },
    body,
  });
  if (!r.ok) throw new Error(`Update ${r.status}`);
  return true;
}

export async function saveUrlToDrive(env, token, fileUrl, name) {
  const at = token || (await getAccessToken(env));
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
      Authorization: `Bearer ${at}`,
      "Content-Type": "multipart/related; boundary=x",
    },
    body: full,
  });

  const j = await r.json();
  if (!r.ok) throw new Error(`Upload ${r.status}`);
  return j;
}

/* ============ Зручні alias-експорти для зворотної сумісності ============ */
export async function drivePing(env) {
  const files = await listFiles(env);
  return { ok: true, filesCount: files.files?.length || 0 };
}
export const driveList = listFiles;
export const driveListLatest = listFiles;
export const driveSaveFromUrl = saveUrlToDrive;
export const driveAppendLog = appendToChecklist;

/* ==================== Клас-обгортка для імпорту { Drive } ==================== */
export class Drive {
  constructor(env) {
    this.env = env;
  }
  async getAccessToken() { return getAccessToken(this.env); }
  async ping() { return drivePing(this.env); }
  async list() { return listFiles(this.env); }
  async listLatest() { return listFiles(this.env); }
  async saveFromUrl(url, name) { return saveUrlToDrive(this.env, undefined, url, name); }
  async appendLog(line) { return appendToChecklist(this.env, undefined, line); }
  async ensureChecklist() { return ensureChecklist(this.env); }
}

// Явний іменований експорт класу (на випадок трансформацій білда)
export { Drive as default };