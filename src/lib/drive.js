// Lightweight Google Drive client for Cloudflare Workers (Service Account, JWT)

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
const DRIVE_FILES_URL  = "https://www.googleapis.com/drive/v3/files";

function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: env.GDRIVE_SA_EMAIL,
    scope: "https://www.googleapis.com/auth/drive.file",
    aud: OAUTH_TOKEN_URL,
    exp: now + 60 * 60, // 1h
    iat: now,
  };
  const enc = (obj) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj)))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  const unsigned = enc(header) + "." + enc(claim);

  const keyData = pemToArrayBuffer(env.GDRIVE_PRIVATE_KEY);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  const jwt = `${unsigned}.${sigB64}`;

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error("Token error: " + t);
  }
  const json = await res.json();
  return json.access_token;
}

function guessNameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop() || "file";
    return last.includes(".") ? last : last + ".bin";
  } catch {
    return "file.bin";
  }
}

export async function drivePing(env) {
  const token = await getAccessToken(env);
  const q = new URLSearchParams({
    q: `'${env.GDRIVE_FOLDER_ID}' in parents and trashed = false`,
    pageSize: "1",
    fields: "files(id,name)",
  });
  const res = await fetch(`${DRIVE_FILES_URL}?${q}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Drive list failed: " + (await res.text()));
  return true;
}

export async function driveSaveFromUrl(env, fileUrl, nameOptional) {
  const token = await getAccessToken(env);

  // 1) завантажуємо файл у воркер
  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) throw new Error(`Fetch failed (${fileRes.status})`);
  const buf = new Uint8Array(await fileRes.arrayBuffer());

  const filename = (nameOptional && nameOptional.trim()) || guessNameFromUrl(fileUrl);
  const boundary = "----senti-drive-" + Math.random().toString(16).slice(2);

  const metadata = {
    name: filename,
    parents: [env.GDRIVE_FOLDER_ID],
  };

  const metaPart =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) + `\r\n`;

  const filePartHeader =
    `--${boundary}\r\n` +
    `Content-Type: ${env.GDRIVE_DEFAULT_MIME || "application/octet-stream"}\r\n\r\n`;

  const footer = `\r\n--${boundary}--\r\n`;

  // Склеюємо multipart тіло
  const encoder = new TextEncoder();
  const body = new Blob([
    encoder.encode(metaPart),
    encoder.encode(filePartHeader),
    buf,
    encoder.encode(footer),
  ]);

  const upload = await fetch(DRIVE_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!upload.ok) {
    const t = await upload.text();
    throw new Error("Upload failed: " + t);
  }

  const json = await upload.json(); // { id, name, ... }
  // робимо shareable link (optional, лише якщо папка дозволяє)
  const webView = `https://drive.google.com/file/d/${json.id}/view`;
  return { id: json.id, name: json.name, link: webView };
}
