// src/lib/codexDrive.js
// Допоміжні утиліти для інтеграції Senti Codex з Google Drive:
// - оновлення токенів
// - створення ієрархії папок SentiCodex
// - завантаження текстових файлів у repo / exports
// - завантаження будь-яких assets з URL (фото/док/voice/video).

import { getUserTokens, putUserTokens } from "./userDrive.js";

const SEC = () => Math.floor(Date.now() / 1000);

// ---------- OAuth: refresh + ensure ----------
async function refreshAccessToken(env, tokens) {
  if (!tokens?.refresh_token) {
    throw new Error("no_refresh_token");
  }

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
      `google_refresh_failed: ${r.status} ${r.statusText} :: ${JSON.stringify(
        d
      )}`
    );
  }

  return {
    access_token: d.access_token,
    refresh_token: tokens.refresh_token,
    expiry: SEC() + Number(d.expires_in || 3600) - 60,
  };
}

async function ensureAccessToken(env, userId) {
  let tokens = await getUserTokens(env, userId);
  if (!tokens || !tokens.access_token) throw new Error("no_tokens");

  if (Number(tokens.expiry || 0) > SEC() + 15) return tokens;

  if (tokens.refresh_token) {
    const next = await refreshAccessToken(env, tokens);
    await putUserTokens(env, userId, next);
    return next;
  }
  throw new Error("expired_no_refresh");
}

async function driveFetch(env, userId, url, init = {}) {
  const tokens = await ensureAccessToken(env, userId);
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${tokens.access_token}`);
  return await fetch(url, { ...init, headers });
}

// ---------- Папки / шлях ієрархії ----------
async function driveFindOrCreateFolder(env, userId, name, parentId = "root") {
  const q = `'${parentId}' in parents and name='${String(name).replace(
    /'/g,
    "\\'"
  )}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const listUrl = new URL("https://www.googleapis.com/drive/v3/files");
  listUrl.searchParams.set("q", q);
  listUrl.searchParams.set("fields", "files(id,name)");

  const r = await driveFetch(env, userId, listUrl.toString());
  const j = await r.json().catch(() => ({}));
  const found = Array.isArray(j.files) && j.files[0];
  if (found) return found.id;

  // створюємо, якщо не існує
  const create = await driveFetch(
    env,
    userId,
    "https://www.googleapis.com/drive/v3/files",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: parentId === "root" ? undefined : [parentId],
      }),
    }
  );
  const created = await create.json().catch(() => ({}));
  if (!create.ok || !created?.id) {
    throw new Error("drive_folder_create_failed");
  }
  return created.id;
}

/**
 * Забезпечує повний шлях типу:
 * ["SentiCodex", "<userId>", "<project>", "repo"]
 * Повертає id останньої папки.
 */
export async function codexEnsurePath(env, userId, parts) {
  let parent = "root";
  for (const name of parts) {
    parent = await driveFindOrCreateFolder(env, userId, name, parent);
  }
  return parent;
}

// ---------- Завантаження тексту (Markdown/Plain) ----------
export async function codexUploadText(env, userId, { parentId, name, content, mimeType = "text/markdown" }) {
  const boundary = `senti-${crypto.randomUUID()}`;
  const metadata = {
    name,
    mimeType,
    parents: parentId === "root" ? undefined : [parentId],
  };

  const enc = new TextEncoder();
  const pre =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
      metadata
    )}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}; charset=UTF-8\r\n\r\n`;
  const post = `\r\n--${boundary}--`;

  const body = new Blob(
    [enc.encode(pre), enc.encode(content || ""), enc.encode(post)],
    { type: `multipart/related; boundary=${boundary}` }
  );

  const url = new URL("https://www.googleapis.com/upload/drive/v3/files");
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("fields", "id,name,webViewLink");

  const up = await driveFetch(env, userId, url.toString(), {
    method: "POST",
    body,
  });
  const data = await up.json().catch(() => ({}));
  if (!up.ok) {
    throw new Error(
      `drive_upload_text_failed ${up.status} ${up.statusText}`
    );
  }
  return data;
}
// ---------- Синхронізація секцій repo ----------

/**
 * Оновити один файл секції проєкту в папці repo на Drive.
 * Викликається з Codex при зміні README/idea/spec/... .
 */
export async function codexSyncSection(env, userId, project, file, content) {
  try {
    const root = await codexEnsurePath(env, userId, [
      "SentiCodex",
      String(userId),
      project,
      "repo",
    ]);
    await codexUploadText(env, userId, {
      parentId: root,
      name: file,
      content,
    });
  } catch {
    // Тихо ігноруємо, щоб не ламати основний сценарій
  }
}

/**
 * Початкова структура проєкту на Drive:
 * SentiCodex/<uid>/<project>/{assets,repo,exports}
 * + вивантаження початкових секцій у repo.
 */
export async function codexBootstrapProject(
  env,
  userId,
  name,
  initialSections
) {
  try {
    await codexEnsurePath(env, userId, [
      "SentiCodex",
      String(userId),
      name,
    ]);
    await codexEnsurePath(env, userId, [
      "SentiCodex",
      String(userId),
      name,
      "assets",
    ]);
    const repo = await codexEnsurePath(env, userId, [
      "SentiCodex",
      String(userId),
      name,
      "repo",
    ]);
    await codexEnsurePath(env, userId, [
      "SentiCodex",
      String(userId),
      name,
      "exports",
    ]);

    for (const [fname, body] of Object.entries(initialSections || {})) {
      await codexUploadText(env, userId, {
        parentId: repo,
        name: fname,
        content: body || "",
      });
    }
  } catch {
    // Ігноруємо — Codex продовжить працювати з KV навіть без Drive
  }
}

/**
 * Створити snapshot-папку з поточними секціями:
 * SentiCodex/<uid>/<project>/exports/<snapshotName>/*
 */
export async function codexExportSnapshot(
  env,
  userId,
  project,
  snapshotName,
  allSections
) {
  try {
    const exportsId = await codexEnsurePath(env, userId, [
      "SentiCodex",
      String(userId),
      project,
      "exports",
      snapshotName,
    ]);

    for (const [fname, body] of Object.entries(allSections || {})) {
      await codexUploadText(env, userId, {
        parentId: exportsId,
        name: fname,
        content: body || "",
      });
    }

    const readme = `Це знімок проєкту "${project}".\nЩоб отримати ZIP: у Google Drive оберіть цю папку → "Download".`;
    await codexUploadText(env, userId, {
      parentId: exportsId,
      name: "README.txt",
      content: readme,
      mimeType: "text/plain",
    });
  } catch {
    // теж не ламаємо основний сценарій
  }
}

/**
 * Завантажити будь-який asset (фото/док/voice/video) за прямим URL:
 * кладемо у SentiCodex/<uid>/<project>/assets/<name>.
 */
export async function codexUploadAssetFromUrl(
  env,
  userId,
  project,
  url,
  defaultName
) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("asset_source_fetch_failed");
    const buf = await resp.arrayBuffer();

    const base = await codexEnsurePath(env, userId, [
      "SentiCodex",
      String(userId),
      project,
      "assets",
    ]);

    const boundary = `senti-${crypto.randomUUID()}`;
    const meta = { name: defaultName, parents: [base] };

    const enc = new TextEncoder();
    const pre =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`;
    const post = `\r\n--${boundary}--`;

    const body = new Blob(
      [enc.encode(pre), new Uint8Array(buf), enc.encode(post)],
      { type: `multipart/related; boundary=${boundary}` }
    );

    const urlUp = new URL("https://www.googleapis.com/upload/drive/v3/files");
    urlUp.searchParams.set("uploadType", "multipart");
    urlUp.searchParams.set("fields", "id,name,webViewLink");

    const up = await driveFetch(env, userId, urlUp.toString(), {
      method: "POST",
      body,
    });
    if (!up.ok) throw new Error("asset_upload_failed");
    return true;
  } catch {
    return false;
  }
}