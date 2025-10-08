// src/lib/drive.js
// Повна версія з фіксом папки, явними помилками, підтримкою Telegram file_id
// і дружнім save() (перетворення шарінг-лінків + fallback-плейсхолдер)

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const OAUTH_KEY = "google_oauth";

// ---------- Утиліти ----------
function nowSec() { return Math.floor(Date.now() / 1000); }

function extFromName(name) {
  const m = /\.[A-Za-z0-9]{1,8}$/.exec(name || "");
  return m ? m[0] : "";
}

function filenameFromUrl(u) {
  try {
    const url = new URL(u);
    const last = url.pathname.split("/").filter(Boolean).pop() || "file";
    return decodeURIComponent(last);
  } catch { return "file"; }
}

// ---------- KV токени ----------
function ensureKv(env) {
  if (!env.OAUTH_KV) {
    throw new Error("OAUTH_KV binding missing — додай [[kv_namespaces]] у wrangler.toml і задеплой");
  }
  return env.OAUTH_KV;
}

async function readKvTokens(env) {
  const kv = ensureKv(env);
  const raw = await kv.get(OAUTH_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function writeKvTokens(env, data) {
  const kv = ensureKv(env);
  await kv.delete(OAUTH_KEY).catch(() => {});
  await kv.put(OAUTH_KEY, JSON.stringify(data));
}

export async function getAccessToken(env) {
  const kv = await readKvTokens(env);
  if (kv?.access_token && kv.expiry > nowSec() + 10) return kv.access_token;

  if (kv?.refresh_token) {
    const next = await refreshAccessToken(env, kv.refresh_token);
    await writeKvTokens(env, next);
    return next.access_token;
  }
  throw new Error("Google Drive auth missing — пройди авторизацію /auth");
}

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
    refresh_token,
    expiry: nowSec() + (d.expires_in || 3600) - 60,
  };
}

// ---------- Вибір папки ----------
function getFolderId(env) {
  const raw = (env.DRIVE_FOLDER_ID || "").trim();
  if (raw && raw !== "." && raw.toLowerCase() !== "root") return raw;
  return "root";
}

// ---------- Лінки -> прямі даунлоади (синхронні перетворення) ----------
function resolveSimpleDownloadUrl(raw) {
  try {
    const u = new URL(raw);

    // Google Drive share -> direct
    if (u.hostname.endsWith("drive.google.com")) {
      const id = u.searchParams.get("id") ||
                 (/\/file\/d\/([^/]+)/.exec(u.pathname)?.[1] ?? null);
      if (id) return `https://drive.google.com/uc?export=download&id=${id}`;
    }

    // Dropbox share -> dl=1
    if (u.hostname.endsWith("dropbox.com")) {
      u.searchParams.set("dl", "1");
      return u.toString();
    }

    // GitHub blob -> raw
    if (u.hostname === "github.com" && /\/blob\//.test(u.pathname)) {
      return u.href.replace("/blob/", "/raw/");
    }

    // Gist -> raw
    if (u.hostname === "gist.github.com" && /\/([a-f0-9]+)$/.test(u.pathname)) {
      return u.toString().replace("gist.github.com", "gist.githubusercontent.com") + "/raw";
    }

    return raw;
  } catch {
    return raw;
  }
}

// ---------- Telegram helpers (асинхронні) ----------
function pickBotToken(env) {
  return env.BOT_TOKEN || env.TELEGRAM_BOT_TOKEN || null;
}

// Витягнути file_id з "url" різних форм
function parseTelegramFileId(input) {
  if (!input) return null;

  // 1) Явна форма: tg-file-id:<id>
  const tg1 = /^tg-file-id:(.+)$/i.exec(input);
  if (tg1) return tg1[1];

  // 2) telegram:file_id=<id>
  const tg2 = /^telegram:file_id=(.+)$/i.exec(input);
  if (tg2) return tg2[1];

  // 3) Прямий api.telegram.org/file/... — вже готовий, повернемо як «url», не file_id
  if (/^https:\/\/api\.telegram\.org\/file\/bot[^/]+\/.+/i.test(input)) {
    return { directUrl: input };
  }

  // Інші t.me посилання без авторизації не зкачаєш анонімно
  return null;
}

// Отримати прямий URL через getFile
async function telegramDirectUrlFromFileId(env, fileId) {
  const token = pickBotToken(env);
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN/BOT_TOKEN missing in bindings");

  const r = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const j = await r.json();
  if (!j.ok) throw new Error(`Telegram getFile failed: ${JSON.stringify(j)}`);
  const filePath = j.result?.file_path;
  if (!filePath) throw new Error("Telegram getFile: file_path missing");
  return `https://api.telegram.org/file/bot${token}/${filePath}`;
}

// ---------- Основні операції ----------
export async function listFiles(env, token) {
  const fid = getFolderId(env);
  const url = new URL(`${DRIVE_API}/files`);
  url.searchParams.set("q", `'${fid}' in parents and trashed=false`);
  url.searchParams.set("fields", "files(id,name,modifiedTime)");
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`List ${r.status}`);
  return r.json();
}

export async function appendToChecklist(env, token, line) {
  const id = await ensureChecklist(env, token);
  const get = await fetch(`${DRIVE_API}/files/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let txt = "";
  if (get.ok) txt = await get.text();

  const body = (txt || "# Senti checklist\n") + `- ${line}\n`;
  const r = await fetch(`${UPLOAD_API}/files/${id}?uploadType=media`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/markdown",
    },
    body,
  });
  if (!r.ok) throw new Error(`Update ${r.status}`);
  return true;
}

export async function ensureChecklist(env, token) {
  const fid = getFolderId(env);
  const q = `name='senti_checklist.md' and '${fid}' in parents and trashed=false`;
  const search = await fetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const j = await search.json();
  if (j.files?.[0]) return j.files[0].id;

  const meta = { name: "senti_checklist.md", parents: [fid], mimeType: "text/markdown" };
  const body =
    `--x\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--x\r\n` +
    `Content-Type: text/markdown\r\n\r\n# Senti checklist\n\r\n--x--`;

  const r = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/related; boundary=x" },
    body,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Create checklist ${r.status}: ${JSON.stringify(d)}`);
  return d.id;
}

// Головний аплоад з підтримкою Telegram і fallback-плейсхолдером
export async function saveUrlToDrive(env, token, fileUrl, name) {
  const fid = getFolderId(env);

  // ----- Telegram? -----
  let resolvedUrl = null;
  const tgParsed = parseTelegramFileId(fileUrl);
  if (tgParsed && typeof tgParsed === "object" && tgParsed.directUrl) {
    resolvedUrl = tgParsed.directUrl;
  } else if (typeof tgParsed === "string") {
    try {
      resolvedUrl = await telegramDirectUrlFromFileId(env, tgParsed);
    } catch (e) {
      // Якщо не вийшло — створимо плейсхолдер із причиною
      return await createPlaceholderNote(env, token, fid, name || "telegram-file.md", fileUrl, "(file_id)", e);
    }
  }

  // Не Telegram — спробуємо прості перетворення
  if (!resolvedUrl) {
    resolvedUrl = resolveSimpleDownloadUrl(fileUrl);
  }

  // Ім'я файлу
  let filename = (name && name.trim()) || filenameFromUrl(resolvedUrl);
  if (!extFromName(filename)) filename += "";

  // Спроба скачати
  let resp, buf, contentType = "application/octet-stream";
  try {
    resp = await fetch(resolvedUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const ct = resp.headers.get("content-type");
    if (ct) contentType = ct.split(";")[0];
    buf = await resp.arrayBuffer();
  } catch (e) {
    // Fallback: створюємо .md з поясненням
    return await createPlaceholderNote(env, token, fid, filename, fileUrl, resolvedUrl, e);
  }

  // Multipart аплоад у Drive
  const meta = { name: filename, parents: [fid] };
  const head =
    `--x\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--x\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`;
  const full = new Blob([head, new Uint8Array(buf), "\r\n--x--"]);

  const r = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/related; boundary=x" },
    body: full,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Upload ${r.status}: ${JSON.stringify(j)}`);
  return j;
}

// Створити markdown-пояснення замість файлу (щоб не губити запити)
async function createPlaceholderNote(env, token, fid, filename, originalUrl, resolvedUrl, reason) {
  const meta = {
    name: filename.replace(/(\.[A-Za-z0-9]{1,8})?$/, "") + ".md",
    parents: [fid],
    mimeType: "text/markdown"
  };
  const note =
`# Не вдалося завантажити файл

**Оригінальний URL:** ${originalUrl}
**Resolved:** ${resolvedUrl}

**Причина:** ${String(reason?.message || reason)}

> Джерело могло повернути 403/404 або вимагати авторизацію.
`;

  const head =
    `--x\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--x\r\n` +
    `Content-Type: text/markdown\r\n\r\n`;
  const full = new Blob([head, note, "\r\n--x--"]);

  const r = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/related; boundary=x" },
    body: full,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Upload placeholder ${r.status}: ${JSON.stringify(j)}`);
  return { placeholder: true, ...j };
}

// ---------- Старі alias-експорти ----------
export async function drivePing(env) {
  const token = await getAccessToken(env);
  const files = await listFiles(env, token);
  return { ok: true, filesCount: files.files?.length || 0 };
}
export const driveList = listFiles;
export const driveListLatest = listFiles;
export const driveSaveFromUrl = saveUrlToDrive;
export const driveAppendLog = appendToChecklist;