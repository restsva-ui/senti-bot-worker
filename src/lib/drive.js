// src/lib/drive.js
//
// Підтримує два способи автентифікації:
// 1) env.GDRIVE_TOKEN — готовий access token (робить як і раніше)
// 2) env.GOOGLE_REFRESH_TOKEN + GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET —
//    автоматичний обмін на access token (рекомендовано)
//
// Обов'язково: env.DRIVE_FOLDER_ID — ID цільової папки в Drive

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Отримати робочий access token */
async function getAccessToken(env) {
  // 1) Якщо дали напряму — використовуємо.
  if (env.GDRIVE_TOKEN && String(env.GDRIVE_TOKEN).trim()) {
    return env.GDRIVE_TOKEN.trim();
  }

  // 2) Якщо є рефреш — міняємо на access token.
  const rt = env.GOOGLE_REFRESH_TOKEN;
  const cid = env.GOOGLE_CLIENT_ID;
  const csec = env.GOOGLE_CLIENT_SECRET;

  if (rt && cid && csec) {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: rt,
      client_id: cid,
      client_secret: csec,
    });

    const res = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw new Error(
        `OAuth exchange failed: ${res.status} ${res.statusText} ${JSON.stringify(data)}`
      );
    }
    return data.access_token;
  }

  // 3) Інакше — нічим автентифікуватися
  throw new Error("GDRIVE_TOKEN is missing (або налаштуйте GOOGLE_REFRESH_TOKEN + CLIENT_ID + CLIENT_SECRET)");
}

async function authHeaders(env) {
  const token = await getAccessToken(env);
  return { Authorization: `Bearer ${token}` };
}

async function gjson(res) {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

async function gtext(res) {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return res.text();
}

export async function drivePing(env) {
  if (!env.DRIVE_FOLDER_ID) throw new Error("DRIVE_FOLDER_ID is missing");
  const headers = await authHeaders(env);
  const url = `${API}/files?pageSize=1&fields=files(id)&q=${encodeURIComponent(
    `'${env.DRIVE_FOLDER_ID}' in parents and trashed=false`
  )}`;
  const res = await fetch(url, { headers });
  await gjson(res);
  return true;
}

export async function driveListLatest(env, n = 10) {
  if (!env.DRIVE_FOLDER_ID) throw new Error("DRIVE_FOLDER_ID is missing");
  const headers = await authHeaders(env);

  const url =
    `${API}/files?` +
    new URLSearchParams({
      q: `'${env.DRIVE_FOLDER_ID}' in parents and trashed=false`,
      orderBy: "modifiedTime desc",
      pageSize: String(n),
      fields: "files(id,name,webViewLink,modifiedTime)",
      spaces: "drive",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    }).toString();

  const res = await fetch(url, { headers });
  const data = await gjson(res);
  return data.files || [];
}

async function findByName(env, name) {
  const headers = await authHeaders(env);
  const q = [
    `'${env.DRIVE_FOLDER_ID}' in parents`,
    "trashed=false",
    `name='${String(name).replace(/'/g, "\\'")}'`,
  ].join(" and ");

  const url = `${API}/files?q=${encodeURIComponent(
    q
  )}&fields=files(id,name,webViewLink,modifiedTime)&pageSize=1`;
  const res = await fetch(url, { headers });
  const data = await gjson(res);
  return (data.files && data.files[0]) || null;
}

async function getFileContent(env, id) {
  const headers = await authHeaders(env);
  const url = `${API}/files/${id}?alt=media`;
  const res = await fetch(url, { headers });
  return await gtext(res);
}

async function uploadMultipart(env, { id, name, mime = "application/octet-stream", content }) {
  const headers = await authHeaders(env);
  const boundary = "boundary" + Math.random().toString(16).slice(2);
  const meta = JSON.stringify({
    name,
    parents: id ? undefined : [env.DRIVE_FOLDER_ID],
  });

  const bodyParts = [
    `--${boundary}`,
    `Content-Type: application/json; charset=UTF-8`,
    ``,
    meta,
    `--${boundary}`,
    `Content-Type: ${mime}`,
    ``,
    typeof content === "string" ? content : await content.arrayBuffer(),
    `--${boundary}--`,
    ``,
  ];

  const blobs = bodyParts.map((p) =>
    typeof p === "string" ? new Blob([p + "\r\n"]) : new Blob([p])
  );
  const body = new Blob(blobs);

  const url = id
    ? `${UPLOAD}/${id}?uploadType=multipart&supportsAllDrives=true`
    : `${UPLOAD}?uploadType=multipart&supportsAllDrives=true`;

  const res = await fetch(url, {
    method: id ? "PATCH" : "POST",
    headers: {
      ...headers,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const data = await gjson(res);

  const infoRes = await fetch(
    `${API}/files/${data.id}?fields=id,name,webViewLink,modifiedTime`,
    { headers }
  );
  return await gjson(infoRes);
}

/** Додати один рядок у markdown-файл (створить, якщо не існує) */
export async function driveAppendLog(env, filename, line) {
  const safeLine = String(line || "").replace(/\r?\n/g, " ").trim();
  let file = await findByName(env, filename);

  const append = `\n${safeLine}`;
  if (!file) {
    file = await uploadMultipart(env, {
      name: filename,
      mime: "text/markdown; charset=UTF-8",
      content: append.trimStart(),
    });
    return file;
  }

  const current = await getFileContent(env, file.id);
  const updated = current.endsWith("\n") ? current + safeLine + "\n" : current + append + "\n";

  const updatedFile = await uploadMultipart(env, {
    id: file.id,
    name: file.name,
    mime: "text/markdown; charset=UTF-8",
    content: updated,
  });
  return updatedFile;
}

/** Завантажити файл у Drive із зовнішнього URL */
export async function driveSaveFromUrl(env, url, name = "") {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Завантаження URL: ${resp.status} ${resp.statusText}`);

  let finalName = String(name || "").trim();
  if (!finalName) {
    const cd = resp.headers.get("content-disposition") || "";
    const m = cd.match(/filename\*?=(?:UTF-8'')?("?)([^";]+)\1/i);
    if (m) finalName = decodeURIComponent(m[2]);
  }
  if (!finalName) {
    try {
      finalName = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
    } catch {}
  }
  if (!finalName) finalName = "file.bin";

  const contentType = resp.headers.get("content-type") || "application/octet-stream";
  const blob = await resp.blob();

  const saved = await uploadMultipart(env, {
    name: finalName,
    mime: contentType,
    content: blob,
  });
  return { id: saved.id, name: saved.name, link: saved.webViewLink };
}

/* === АЛІАС ДЛЯ ЗВОРОТНОЇ СУМІСНОСТІ === */
export const driveList = driveListLatest;