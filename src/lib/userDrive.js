// src/lib/userDrive.js

// ===== Helpers for KV =====
const TOK_KEY = (uid) => `user_oauth:${String(uid)}`;

// Read user's tokens from KV
export async function getUserTokens(env, userId) {
  if (!env.USER_OAUTH_KV) throw new Error("USER_OAUTH_KV binding missing");
  const raw = await env.USER_OAUTH_KV.get(TOK_KEY(userId));
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

// Write user's tokens to KV (persist without TTL)
export async function putUserTokens(env, userId, tokens) {
  if (!env.USER_OAUTH_KV) throw new Error("USER_OAUTH_KV binding missing");
  // Normalize structure, avoid undefined leaking
  const safe = {
    access_token: tokens?.access_token || "",
    refresh_token: tokens?.refresh_token || "", // may be empty string
    expiry: Number(tokens?.expiry || 0),        // seconds epoch
  };
  await env.USER_OAUTH_KV.put(TOK_KEY(userId), JSON.stringify(safe));
  return safe;
}

// ===== Google OAuth helpers =====
function nowSec() { return Math.floor(Date.now() / 1000); }

async function refreshAccessToken(env, tokens) {
  // If no refresh_token, we cannot refresh
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
    body: params
  });
  const d = await r.json().catch(()=> ({}));
  if (!r.ok) {
    const msg = `google_refresh_failed: ${r.status} ${r.statusText} :: ${JSON.stringify(d)}`;
    throw new Error(msg);
  }

  // Google may or may not return refresh_token here — keep the old one
  const next = {
    access_token: d.access_token,
    refresh_token: tokens.refresh_token,
    expiry: nowSec() + Number(d.expires_in || 3600) - 60
  };
  return next;
}

// Ensure we have a valid access token; refresh if needed (when possible)
async function ensureAccessToken(env, userId) {
  let tokens = await getUserTokens(env, userId);
  if (!tokens || !tokens.access_token) {
    const e = new Error("no_tokens");
    e.hint = "Авторизуйся через /auth/start";
    throw e;
  }

  const exp = Number(tokens.expiry || 0);
  if (exp > nowSec() + 15) {
    // still valid
    return tokens;
  }

  // expired (or about to); try refresh if we can
  if (tokens.refresh_token) {
    const next = await refreshAccessToken(env, tokens);
    await putUserTokens(env, userId, next);
    return next;
  }

  // no refresh token — cannot refresh
  const e = new Error("expired_no_refresh");
  e.hint = "Потрібна повторна авторизація (натисни «Google Drive» і підтверди доступ).";
  throw e;
}

// ===== Google Drive API =====
async function driveRequest(env, userId, path, init = {}, query = {}) {
  const tokens = await ensureAccessToken(env, userId);
  const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
  Object.entries(query).forEach(([k,v]) => url.searchParams.set(k, v));

  const r = await fetch(url.toString(), {
    ...init,
    headers: {
      ...(init.headers || {}),
      "Authorization": `Bearer ${tokens.access_token}`,
    }
  });

  // Some Drive endpoints return 204/empty; try to JSON-parse otherwise
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* keep as text */ }

  if (!r.ok) {
    const msg = `drive_error ${r.status} ${r.statusText}: ${text || "(no body)"}`;
    const err = new Error(msg);
    err.status = r.status;
    err.data = data || text;
    throw err;
  }
  return data;
}

// List files (simple sample)
export async function userListFiles(env, userId, { pageSize = 10 } = {}) {
  const q = {
    pageSize: String(pageSize),
    fields: "files(id,name,webViewLink,mimeType),nextPageToken"
  };
  const data = await driveRequest(env, userId, "files", {}, q);
  return data;
}

// Save by URL (download then upload)
export async function userSaveUrl(env, userId, fileUrl, name = "file") {
  // 1) Fetch binary from given URL (e.g., Telegram file URL)
  const binResp = await fetch(fileUrl);
  if (!binResp.ok) {
    throw new Error(`fetch_source_failed: ${binResp.status} ${binResp.statusText}`);
  }
  const srcType = binResp.headers.get("content-type") || "application/octet-stream";
  const bin = await binResp.arrayBuffer();

  // 2) Prepare metadata & multipart body
  const folder = env.DRIVE_FOLDER_ID && env.DRIVE_FOLDER_ID !== "root"
    ? [env.DRIVE_FOLDER_ID]
    : undefined;

  const metadata = {
    name: String(name || "file"),
    ...(folder ? { parents: folder } : {})
  };

  const boundary = `senti-${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const preamble =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${srcType}\r\n\r\n`;
  const epilogue = `\r\n--${boundary}--`;

  const body = new Blob([encoder.encode(preamble), new Uint8Array(bin), encoder.encode(epilogue)], {
    type: `multipart/related; boundary=${boundary}`
  });

  // 3) Upload to Drive (upload endpoint)
  const tokens = await ensureAccessToken(env, userId); // ensure fresh token right before upload
  const uploadUrl = new URL("https://www.googleapis.com/upload/drive/v3/files");
  uploadUrl.searchParams.set("uploadType", "multipart");
  uploadUrl.searchParams.set("fields", "id,name,webViewLink");

  const up = await fetch(uploadUrl.toString(), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${tokens.access_token}`,
      // Let fetch set the proper multipart content-type with boundary taken from Blob
    },
    body
  });

  const text = await up.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }

  if (!up.ok) {
    const msg = `drive_upload_failed ${up.status} ${up.statusText}: ${text || "(no body)"}`;
    const err = new Error(msg);
    err.status = up.status;
    err.data = data || text;
    throw err;
  }

  return data || { name };
}