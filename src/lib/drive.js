// src/lib/drive.js
// Google Drive клієнт для Cloudflare Workers.
// Підтримує 2 режими:
//   1) Service Account (JWT)            -> GOOGLE_IS_SERVICE=true
//   2) Особистий доступ (OAuth token)   -> GOOGLE_IS_SERVICE=false + GOOGLE_ACCESS_TOKEN

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_UPLOAD_MULTIPART =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";

/* ========================== Допоміжні ========================== */

// Читаємо DRIVE_FOLDER_ID
function ensureFolder(env) {
  const id = env.DRIVE_FOLDER_ID;
  if (!id) throw new Error("Missing DRIVE_FOLDER_ID (Cloudflare Variable)");
  return id;
}

// Чи увімкнено Service Account?
function isService(env) {
  const v = String(env.GOOGLE_IS_SERVICE ?? "true").toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes";
}

// Розбір секрету GOOGLE_DRIVE_CREDENTIALS (повний JSON)
function getCreds(env) {
  if (!env.GOOGLE_DRIVE_CREDENTIALS)
    throw new Error("Missing secret GOOGLE_DRIVE_CREDENTIALS");
  let creds;
  try {
    creds = JSON.parse(env.GOOGLE_DRIVE_CREDENTIALS);
  } catch (e) {
    throw new Error("GOOGLE_DRIVE_CREDENTIALS is not valid JSON");
  }
  if (!creds.client_email || !creds.private_key) {
    throw new Error(
      "GOOGLE_DRIVE_CREDENTIALS must include client_email and private_key"
    );
  }
  return creds;
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

// Генеруємо access_token для Service Account
async function getServiceAccessToken(env) {
  const creds = getCreds(env);
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: creds.client_email,
    sub: creds.client_email, // як сервісний акаунт
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
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );
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

// Повертає access_token відповідно до режиму
async function getAccessToken(env) {
  if (isService(env)) {
    return await getServiceAccessToken(env);
  }
  // Особистий токен (виданий OAuth Playground)
  const tok = env.GOOGLE_ACCESS_TOKEN;
  if (!tok) {
    throw new Error(
      "Missing GOOGLE_ACCESS_TOKEN (set GOOGLE_IS_SERVICE=false to use it)"
    );
  }
  return tok;
}

// Витягаємо ім’я файлу з Content-Disposition (якщо є)
function nameFromContentDisposition(dispo) {
  if (!dispo) return null;
  // приклади: attachment; filename="my.pdf"  |  attachment; filename*=UTF-8''my.pdf
  const m1 = dispo.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  if (m1 && m1[1]) {
    try {
      return decodeURIComponent(m1[1]);
    } catch {
      return m1[1];
    }
  }
  return null;
}

// Резервне ім’я з URL
function guessNameFromUrl(u) {
  try {
    const url = new URL(u);
    const last = url.pathname.split("/").pop() || "file";
    return last.includes(".") ? last : last + ".bin";
  } catch {
    return "file.bin";
  }
}

/* ========================== Публічні функції ========================== */

export async function drivePing(env) {
  const token = await getAccessToken(env);
  const folderId = ensureFolder(env);
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const url =
    `${DRIVE_FILES_URL}?q=${q}` +
    `&pageSize=1&fields=files(id,name)` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Drive ping failed: " + (await res.text()));
  return true;
}

export async function driveSaveFromUrl(env, fileUrl, nameOptional) {
  const token = await getAccessToken(env);
  const folderId = ensureFolder(env);

  // 1) завантажуємо файл у воркер
  const src = await fetch(fileUrl);
  if (!src.ok) throw new Error(`Fetch failed: ${src.status}`);
  const buf = new Uint8Array(await src.arrayBuffer());

  // Визначаємо ім’я та тип
  const cd = src.headers.get("content-disposition") || "";
  const hintedName = nameFromContentDisposition(cd);
  const filename =
    (nameOptional && nameOptional.trim()) ||
    hintedName ||
    guessNameFromUrl(fileUrl);

  const contentType =
    src.headers.get("content-type") || "application/octet-stream";

  // 2) multipart/related тіло
  const boundary = "----senti-drive-" + Math.random().toString(16).slice(2);
  const metadata = {
    name: filename,
    parents: [folderId],
  };

  const enc = new TextEncoder();
  const metaPart =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n`;

  const filePartHeader =
    `--${boundary}\r\n` + `Content-Type: ${contentType}\r\n\r\n`;

  const footer = `\r\n--${boundary}--\r\n`;

  const body = new Blob([enc.encode(metaPart), enc.encode(filePartHeader), buf, enc.encode(footer)]);

  // 3) завантажуємо у Drive
  const uploadUrl = `${DRIVE_UPLOAD_MULTIPART}&supportsAllDrives=true`;
  const upload = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  const info = await upload.json().catch(() => ({}));
  if (!upload.ok) throw new Error("upload_failed: " + JSON.stringify(info));

  return {
    id: info.id,
    name: info.name,
    link: `https://drive.google.com/file/d/${info.id}/view`,
  };
}

export async function driveList(env, limit = 10) {
  const token = await getAccessToken(env);
  const folderId = ensureFolder(env);
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const fields = encodeURIComponent(
    "files(id,name,modifiedTime,size,webViewLink)"
  );

  const url =
    `${DRIVE_FILES_URL}?q=${q}` +
    `&orderBy=modifiedTime desc&pageSize=${limit}&fields=${fields}` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error("list_failed: " + JSON.stringify(data));
  return data.files || [];
}