// src/lib/drive.js
// Обгортки для роботи з Google Drive, які використовуються у routes/webhook.js
// + Проєктна інтеграція для Senti Codex (структуровані папки, секції, асети, снапшоти)

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

async function driveJSON(env, userId, url, init = {}) {
  const tokens = await ensureAccessToken(env, userId);
  const r = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${tokens.access_token}`,
    },
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) throw new Error(`drive_json ${r.status} ${r.statusText}: ${text || "(no body)"}`);
  return data;
}

async function driveListByName(env, userId, name) {
  const q = `name='${String(name).replace(/'/g, "\\'")}' and trashed=false`;
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", q);
  url.searchParams.set("fields", "files(id,name,mimeType,parents)");
  const r = await driveGet(env, userId, url.toString());
  const j = await r.json().catch(() => ({}));
  return Array.isArray(j.files) ? j.files : [];
}

async function driveFindByNameInParent(env, userId, name, parentId, mimeType) {
  // Пошук файлу/папки за ім’ям у конкретній батьківській папці
  const safeName = String(name).replace(/'/g, "\\'");
  const parentCond = parentId ? `'${parentId}' in parents and ` : "";
  const mimeCond = mimeType ? ` and mimeType='${mimeType}'` : "";
  const q = `${parentCond}name='${safeName}' and trashed=false${mimeCond}`;

  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", q);
  url.searchParams.set("fields", "files(id,name,mimeType,parents)");
  const r = await driveGet(env, userId, url.toString());
  const j = await r.json().catch(() => ({}));
  const list = Array.isArray(j.files) ? j.files : [];
  return list[0] || null;
}

async function driveEnsureFolder(env, userId, name, parentId) {
  const FOLDER = "application/vnd.google-apps.folder";
  const exists = await driveFindByNameInParent(env, userId, name, parentId, FOLDER);
  if (exists) return exists;

  const metadata = {
    name,
    mimeType: FOLDER,
    ...(parentId ? { parents: [parentId] } : {}),
  };
  const url = "https://www.googleapis.com/drive/v3/files";
  const data = await driveJSON(env, userId, url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });
  return data; // { id, name, mimeType }
}

async function driveFindOrCreateProjectRoot(env, userId, projectName) {
  // Корінь для всіх проєктів Codex
  const baseFolderName = "Senti Codex";
  const root = await driveEnsureFolder(env, userId, baseFolderName, env.DRIVE_FOLDER_ID && env.DRIVE_FOLDER_ID !== "root" ? env.DRIVE_FOLDER_ID : null);

  // Папка конкретного проєкту
  const proj = await driveEnsureFolder(env, userId, projectName, root.id);

  // Стандартні підпапки
  const sections = await driveEnsureFolder(env, userId, "sections", proj.id);
  const assets   = await driveEnsureFolder(env, userId, "assets",   proj.id);
  const builds   = await driveEnsureFolder(env, userId, "builds",   proj.id);
  const snapshots= await driveEnsureFolder(env, userId, "snapshots",proj.id);

  return { root, proj, sections, assets, builds, snapshots };
}

async function driveUploadTextInFolder(env, userId, folderId, filename, content, mime = "text/plain") {
  const tokens = await ensureAccessToken(env, userId);

  // Перевіряємо чи є файл з таким ім’ям у цій папці
  const exists = await driveFindByNameInParent(env, userId, filename, folderId, null);

  const metadata = {
    name: filename,
    mimeType: mime,
    parents: [folderId],
  };

  const boundary = `senti-${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const preamble =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `${mime ? `Content-Type: ${mime}` : "Content-Type: text/plain; charset=UTF-8"}\r\n\r\n`;
  const epilogue = `\r\n--${boundary}--`;

  const body = new Blob(
    [encoder.encode(preamble), typeof content === "string" ? encoder.encode(content) : content, encoder.encode(epilogue)],
    { type: `multipart/related; boundary=${boundary}` }
  );

  let url, method;
  if (exists) {
    url = new URL(`https://www.googleapis.com/upload/drive/v3/files/${exists.id}`);
    method = "PATCH";
  } else {
    url = new URL("https://www.googleapis.com/upload/drive/v3/files");
    method = "POST";
  }
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("fields", "id,name,webViewLink,parents");

  const up = await fetch(url.toString(), {
    method,
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    body,
  });

  const text = await up.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!up.ok) {
    throw new Error(`drive_upload_text_failed ${up.status} ${up.statusText}: ${text || "(no body)"}`);
  }
  return data; // {id,name,webViewLink,parents}
}

async function driveUploadBinaryFromUrlInFolder(env, userId, folderId, fileUrl, filename, mime = "application/octet-stream") {
  const tokens = await ensureAccessToken(env, userId);

  // Завантажимо бінарні дані з URL
  const r = await fetch(fileUrl);
  if (!r.ok) throw new Error(`fetch_source_failed ${r.status} ${r.statusText}`);
  const ab = await r.arrayBuffer();
  const bin = new Uint8Array(ab);

  // Перевіряємо чи є файл з таким ім’ям у цій папці
  const exists = await driveFindByNameInParent(env, userId, filename, folderId, null);

  const metadata = {
    name: filename,
    mimeType: mime,
    parents: [folderId],
  };

  const boundary = `senti-${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const preamble =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mime}\r\n\r\n`;
  const epilogue = `\r\n--${boundary}--`;

  // Збираємо multipart body
  const body = new Blob(
    [encoder.encode(preamble), bin, encoder.encode(epilogue)],
    { type: `multipart/related; boundary=${boundary}` }
  );

  let url, method;
  if (exists) {
    url = new URL(`https://www.googleapis.com/upload/drive/v3/files/${exists.id}`);
    method = "PATCH";
  } else {
    url = new URL("https://www.googleapis.com/upload/drive/v3/files");
    method = "POST";
  }
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("fields", "id,name,webViewLink,parents");

  const up = await fetch(url.toString(), {
    method,
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    body,
  });

  const text = await up.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!up.ok) {
    throw new Error(`drive_upload_binary_failed ${up.status} ${up.statusText}: ${text || "(no body)"}`);
  }
  return data;
}

// ── Публічні базові АПІ (твій існуючий інтерфейс) ────────────────────────────

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

// ── РОЗШИРЕННЯ ДЛЯ Senti Codex ПРОЄКТІВ ──────────────────────────────────────

/**
 * Переконатися, що структура проєкту існує, і повернути ідентифікатори папок.
 * Структура:
 *  Senti Codex/
 *    <projectName>/
 *      sections/   (README.md, idea.md, spec.md, progress.md, tasks.md, decisions.md, risks.md, testplan.md)
 *      assets/     (фото, документи, будь-які додатки від юзера)
 *      builds/     (готові збірки/експорти)
 *      snapshots/  (маніфести знімків стану проєкту)
 */
export async function drivePrepareProject(env, userId, projectName) {
  return await driveFindOrCreateProjectRoot(env, userId, projectName);
}

/** Зберегти текстову секцію у папці sections проекту (створити/оновити за назвою). */
export async function driveSaveProjectSection(env, userId, projectName, sectionFilename, content, mime = "text/markdown") {
  const { sections } = await driveFindOrCreateProjectRoot(env, userId, projectName);
  return await driveUploadTextInFolder(env, userId, sections.id, sectionFilename, content, mime);
}

/** Додати рядок до логу проєкту (файл progress.log у корені проєкту). */
export async function driveAppendProjectLog(env, userId, projectName, line) {
  const { proj } = await driveFindOrCreateProjectRoot(env, userId, projectName);
  // Робимо окремий лог у корені проєкту (поряд з підпапками)
  const filename = "progress.log";
  const ts = new Date().toISOString();
  const entry = `[${ts}] ${line}\n`;

  // Прочитаємо, якщо вже існує
  const existing = await driveFindByNameInParent(env, userId, filename, proj.id, null);
  let newContent = entry;

  if (existing) {
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${existing.id}`);
    url.searchParams.set("alt", "media");
    try {
      const r = await driveGet(env, userId, url.toString());
      const old = await r.text();
      // зберігаємо до 500КБ «хвіст»
      const keepBytes = 500_000;
      const tail = old.length > keepBytes ? old.slice(-keepBytes) : old;
      newContent = tail + entry;
    } catch {}
  }

  return await driveUploadTextInFolder(env, userId, proj.id, filename, newContent, "text/plain");
}

/** Зберегти асет (фото/файл) у папці assets проекту за прямим URL. */
export async function driveSaveProjectAssetFromUrl(env, userId, projectName, fileUrl, filename, mime = "application/octet-stream") {
  const { assets } = await driveFindOrCreateProjectRoot(env, userId, projectName);
  return await driveUploadBinaryFromUrlInFolder(env, userId, assets.id, fileUrl, filename, mime);
}

/** Створити снапшот-маніфест проєкту у snapshots (JSON з метаданими/статусом). */
export async function driveCreateProjectSnapshot(env, userId, projectName, manifest) {
  const { snapshots } = await driveFindOrCreateProjectRoot(env, userId, projectName);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `snapshot-${stamp}.json`;
  const body = JSON.stringify({
    project: projectName,
    createdAt: new Date().toISOString(),
    ...manifest,
  }, null, 2);
  return await driveUploadTextInFolder(env, userId, snapshots.id, filename, body, "application/json");
}

/**
 * (Опційно) Зберегти готову збірку/експорт у builds/
 * Приймає готовий Blob/Uint8Array рядком/буфером; ім’я файлу і mime.
 * Якщо у тебе є готовий архів (zip), передай mime="application/zip".
 */
export async function driveSaveBuildArtifact(env, userId, projectName, filename, content, mime = "application/octet-stream") {
  const { builds } = await driveFindOrCreateProjectRoot(env, userId, projectName);
  // Дозволяємо як рядок (текст), так і бінарні дані
  let payload = content;
  if (typeof content === "string") {
    payload = new TextEncoder().encode(content);
  }
  // Переюзаємо text uploader: він приймає будь-які дані, просто з іншим mime
  return await driveUploadTextInFolder(env, userId, builds.id, filename, payload, mime);
}

// ──────────────────────────────────────────────────────────────────────────────
// TODO (за потреби):
// - Реальний ZIP-експорт у builds/: у Worker можна зібрати zip вручну (мін. writer)
//   або сформувати архів локально і завантажити через driveSaveBuildArtifact().
//   Готовий інтерфейс вище вже приймає application/zip.
// ──────────────────────────────────────────────────────────────────────────────