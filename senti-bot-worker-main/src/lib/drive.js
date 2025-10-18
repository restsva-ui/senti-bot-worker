// src/lib/drive.js
// Обгортки для роботи з Google Drive, які використовуються у routes/webhook.js

import {
  getUserTokens,
  putUserTokens,
  userListFiles,
  userSaveUrl,
} from "./userDrive.js";

// ── локальні OAuth утиліти (сумісні з userDrive.js) ──────────────────────────
const nowSec = () => Math.floor(Date.now() / 1000);

async function refreshAccessToken(env, tokens) {
  if (!tokens?.refresh_token) throw new Error("no_refresh_token");

  const params = new URLSearchParams();
  params.set("client_id", env.GOOGLE_CLIENT_ID);
  params.set("client_secret", env.GOOGLE_CLIENT_SECRET);
  params.set("grant_type", "refresh_token");
  params.set("refresh_token", tokens.refresh_token);

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(
      `google_refresh_failed: ${r.status} ${r.statusText} :: ${JSON.stringify(d)}`
    );
  }
  return {
    access_token: d.access_token,
    refresh_token: tokens.refresh_token,
    expiry: nowSec() + Number(d.expires_in || 3600) - 60,
  };
}

async function ensureAccessToken(env, userId) {
  let tokens = await getUserTokens(env, userId);
  if (!tokens || !tokens.access_token) {
    const e = new Error("no_tokens");
    e.hint = "Авторизуйся через /auth/start";
    throw e;
  }
  if (Number(tokens.expiry || 0) > nowSec() + 15) return tokens;

  if (tokens.refresh_token) {
    const next = await refreshAccessToken(env, tokens);
    await putUserTokens(env, userId, next);
    return next;
  }
  const e = new Error("expired_no_refresh");
  e.hint =
    "Потрібна повторна авторизація (натисни «Google Drive» і підтверди доступ).";
  throw e;
}

// ── helpers для Drive REST ────────────────────────────────────────────────────
async function driveGet(env, userId, url) {
  const tokens = await ensureAccessToken(env, userId);
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!r.ok) throw new Error(`drive_get ${r.status} ${r.statusText}`);
  return r;
}

async function driveListByName(env, userId, name) {
  const q = `name='${String(name).replace(/'/g, "\\'")}' and trashed=false`;
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", q);
  url.searchParams.set("fields", "files(id,name,mimeType)");
  const r = await driveGet(env, userId, url.toString());
  const j = await r.json().catch(() => ({}));
  return Array.isArray(j.files) ? j.files : [];
}

// ── ПУБЛІЧНІ АПІ ─────────────────────────────────────────────────────────────

/** Перевірка доступності Drive. Повертає {ok, filesCount}. */
export async function drivePing(env, userId) {
  const uid = userId || env.TELEGRAM_ADMIN_ID;
  const tokens = await getUserTokens(env, uid).catch(() => null);
  let filesCount = 0;
  try {
    const list = await userListFiles(env, uid, { pageSize: 10 });
    filesCount = Array.isArray(list?.files) ? list.files.length : 0;
  } catch {
    // не валимо виклик; просто 0
  }
  return { ok: !!tokens?.refresh_token, filesCount };
}

/** Збереження файлу на Drive користувача за прямим URL. */
export async function driveSaveFromUrl(env, userId, url, name) {
  if (!userId) throw new Error("userId required");
  if (!url) throw new Error("url required");
  return await userSaveUrl(env, userId, url, name || "file");
}

/** Прочитати текстовий файл за назвою. Якщо не знайдено — повертає "". */
export async function driveReadTextByName(env, userId, filename) {
  const uid = userId || env.TELEGRAM_ADMIN_ID;
  const files = await driveListByName(env, uid, filename);
  const file = files[0];
  if (!file) return "";

  const url = new URL(`https://www.googleapis.com/drive/v3/files/${file.id}`);
  url.searchParams.set("alt", "media");

  const r = await driveGet(env, uid, url.toString());
  return await r.text();
}

/**
 * Додати рядок у лог-файл на Drive.
 * Якщо файлу ще нема — створює новий.
 */
export async function driveAppendLog(
  env,
  userId,
  line,
  { filename = "senti_log.txt", keepBytes = 100_000 } = {}
) {
  const uid = userId || env.TELEGRAM_ADMIN_ID;
  const ts = new Date().toISOString();
  const entry = `[${ts}] ${line}\n`;

  const files = await driveListByName(env, uid, filename);
  const file = files[0];

  const tokens = await ensureAccessToken(env, uid);

  // обрізаємо старий хвіст, щоб файл не ріс безкінечно
  let newContent = entry;
  if (file) {
    try {
      const url = new URL(`https://www.googleapis.com/drive/v3/files/${file.id}`);
      url.searchParams.set("alt", "media");
      const r = await driveGet(env, uid, url.toString());
      const old = await r.text();
      const tail = old.length > keepBytes ? old.slice(-keepBytes) : old;
      newContent = tail + entry;
    } catch {
      // не блокуємо append
    }
  }

  const metadata = {
    name: filename,
    mimeType: "text/plain",
    ...(env.DRIVE_FOLDER_ID && env.DRIVE_FOLDER_ID !== "root"
      ? { parents: [env.DRIVE_FOLDER_ID] }
      : {}),
  };

  const boundary = `senti-${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const preamble =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/plain; charset=UTF-8\r\n\r\n`;
  const epilogue = `\r\n--${boundary}--`;

  const body = new Blob(
    [encoder.encode(preamble), encoder.encode(newContent), encoder.encode(epilogue)],
    { type: `multipart/related; boundary=${boundary}` }
  );

  let url, method;
  if (file) {
    url = new URL(`https://www.googleapis.com/upload/drive/v3/files/${file.id}`);
    method = "PATCH";
  } else {
    url = new URL("https://www.googleapis.com/upload/drive/v3/files");
    method = "POST";
  }
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("fields", "id,name,webViewLink");

  const up = await fetch(url.toString(), {
    method,
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    body,
  });

  const text = await up.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!up.ok) {
    throw new Error(
      `drive_append_failed ${up.status} ${up.statusText}: ${text || "(no body)"}`
    );
  }
  return data || { name: filename };
}