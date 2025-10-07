// src/lib/drive.js

/**
 * Пінг Google Drive — перевіряє доступність користувацької папки.
 */
export async function drivePing(env) {
  const folderId = env.DRIVE_USER_FOLDER_ID;
  if (!folderId) throw new Error("DRIVE_USER_FOLDER_ID не задано.");
  const url = `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.GOOGLE_ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error("Drive недоступний: " + res.status);
  return await res.json();
}

/**
 * Зберігає файл за прямим URL у Drive.
 * Використовується для бекапів.
 */
export async function driveSaveFromUrl(env, fileUrl, name = "") {
  const folderId = env.DRIVE_USER_FOLDER_ID;
  if (!folderId) throw new Error("DRIVE_USER_FOLDER_ID не задано.");

  const filename =
    name || fileUrl.split("/").pop().split("?")[0] || "backup.zip";
  const content = await fetch(fileUrl);
  if (!content.ok) throw new Error("Не вдалося отримати файл.");

  const blob = await content.arrayBuffer();

  const uploadUrl = `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
  const metadata = {
    name: filename,
    parents: [folderId],
  };

  const boundary = "SENTI-DRIVE-" + Math.random().toString(36).slice(2);
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const end = `\r\n--${boundary}--`;

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GOOGLE_ACCESS_TOKEN}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: new Blob([body, blob, end]),
  });

  if (!res.ok) throw new Error("Не вдалося завантажити у Drive.");
  const data = await res.json();

  return {
    id: data.id,
    name: data.name,
    link: `https://drive.google.com/file/d/${data.id}/view?usp=drivesdk`,
  };
}

/**
 * Додає текстовий рядок до файлу (для чекліста)
 */
export async function driveAppendLog(env, filename, line) {
  const folderId = env.DRIVE_USER_FOLDER_ID;
  if (!folderId) throw new Error("DRIVE_USER_FOLDER_ID не задано.");

  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=name='${filename}' and '${folderId}' in parents&fields=files(id,name)`;
  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${env.GOOGLE_ACCESS_TOKEN}` },
  });
  const searchData = await searchRes.json();
  const fileId = searchData.files?.[0]?.id;
  if (!fileId) throw new Error("Файл не знайдено.");

  const getUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const oldTextRes = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${env.GOOGLE_ACCESS_TOKEN}` },
  });
  const oldText = await oldTextRes.text();
  const newText = oldText + "\n" + line;

  const uploadUrl = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;
  const res = await fetch(uploadUrl, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${env.GOOGLE_ACCESS_TOKEN}`,
      "Content-Type": "text/plain",
    },
    body: newText,
  });

  if (!res.ok) throw new Error("Не вдалося оновити файл.");
  return {
    webViewLink: `https://drive.google.com/file/d/${fileId}/view?usp=drivesdk`,
  };
}

/**
 * ✅ Отримує останні N файлів із папки Drive
 */
export async function driveListLatest(env, limit = 10) {
  const folderId = env.DRIVE_USER_FOLDER_ID;
  if (!folderId) throw new Error("DRIVE_USER_FOLDER_ID не задано.");

  const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}' in parents&fields=files(id,name,modifiedTime,webViewLink)&orderBy=modifiedTime desc&pageSize=${limit}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.GOOGLE_ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error("Не вдалося отримати список файлів із Drive.");
  const data = await res.json();
  return data.files || [];
}