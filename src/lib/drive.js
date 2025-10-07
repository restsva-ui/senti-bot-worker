// src/lib/drive.js
//
// Працює через OAuth access token у env.GDRIVE_TOKEN
// і ID цільової папки у env.DRIVE_FOLDER_ID.

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

function authHeaders(env) {
  return {
    Authorization: `Bearer ${env.GDRIVE_TOKEN}`,
  };
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
  const url = `${API}/files?pageSize=1&fields=files(id)&q=${encodeURIComponent(
    `'${env.DRIVE_FOLDER_ID}' in parents and trashed=false`
  )}`;
  const res = await fetch(url, { headers: authHeaders(env) });
  await gjson(res);
  return true;
}

export async function driveListLatest(env, n = 10) {
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

  const res = await fetch(url, { headers: authHeaders(env) });
  const data = await gjson(res);
  return data.files || [];
}

async function findByName(env, name) {
  const q = [
    `'${env.DRIVE_FOLDER_ID}' in parents`,
    "trashed=false",
    `name='${name.replace(/'/g, "\\'")}'`,
  ].join(" and ");
  const url = `${API}/files?q=${encodeURIComponent(
    q
  )}&fields=files(id,name,webViewLink,modifiedTime)&pageSize=1`;
  const res = await fetch(url, { headers: authHeaders(env) });
  const data = await gjson(res);
  return (data.files && data.files[0]) || null;
}

async function getFileContent(env, id) {
  const url = `${API}/files/${id}?alt=media`;
  const res = await fetch(url, { headers: authHeaders(env) });
  return await gtext(res);
}

async function uploadMultipart(env, { id, name, mime = "application/octet-stream", content }) {
  // multipart/related
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

  // Перетворюємо у Blob, щоб зберегти binary частину
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
      ...authHeaders(env),
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const data = await gjson(res);

  // доберемо webViewLink
  const infoRes = await fetch(
    `${API}/files/${data.id}?fields=id,name,webViewLink,modifiedTime`,
    { headers: authHeaders(env) }
  );
  return await gjson(infoRes);
}

/**
 * Додати один рядок у markdown-файл (створить, якщо не існує)
 */
export async function driveAppendLog(env, filename, line) {
  const safeLine = String(line || "").replace(/\r?\n/g, " ").trim();
  let file = await findByName(env, filename);

  const append = `\n${safeLine}`;
  if (!file) {
    // створюємо новий
    file = await uploadMultipart(env, {
      name: filename,
      mime: "text/markdown; charset=UTF-8",
      content: append.trimStart(), // без лідінгу, бо новий файл
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

/**
 * Завантажити файл у Drive із зовнішнього URL.
 * name — опціональна назва (з .zip/.txt тощо). Якщо порожня — беремо з URL або Content-Disposition.
 */
export async function driveSaveFromUrl(env, url, name = "") {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Завантаження URL: ${resp.status} ${resp.statusText}`);

  // Визначимо ім'я
  let finalName = String(name || "").trim();
  if (!finalName) {
    const cd = resp.headers.get("content-disposition") || "";
    const m = cd.match(/filename\*?=(?:UTF-8'')?("?)([^";]+)\1/i);
    if (m) finalName = decodeURIComponent(m[2]);
  }
  if (!finalName) {
    try {
      finalName = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
    } catch {
      // ignore
    }
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