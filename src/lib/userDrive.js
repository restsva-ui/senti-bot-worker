// src/lib/userDrive.js
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

function nowSec(){ return Math.floor(Date.now()/1000); }

function key(userId){ return `u:${userId}:google_oauth`; }

function ensureKv(env){
  if(!env.USER_OAUTH_KV) throw new Error("USER_OAUTH_KV binding missing");
  return env.USER_OAUTH_KV;
}

export async function getUserTokens(env, userId){
  const kv = ensureKv(env);
  const raw = await kv.get(key(userId));
  if(!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function putUserTokens(env, userId, data){
  const kv = ensureKv(env);
  await kv.put(key(userId), JSON.stringify(data));
}

export async function getUserAccessToken(env, userId){
  const t = await getUserTokens(env, userId);
  if(!t) throw new Error("not_linked");
  if(t.access_token && t.expiry > nowSec()+10) return t.access_token;
  const next = await refresh(env, t.refresh_token);
  await putUserTokens(env, userId, next);
  return next.access_token;
}

async function refresh(env, refreshToken){
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method:"POST",
    headers:{ "Content-Type":"application/x-www-form-urlencoded" },
    body,
  });
  const d = await r.json();
  if(!r.ok) throw new Error(`refresh ${r.status}: ${JSON.stringify(d)}`);
  return {
    access_token: d.access_token,
    refresh_token,
    expiry: nowSec() + (d.expires_in || 3600) - 60,
  };
}

export async function userListFiles(env, userId){
  const token = await getUserAccessToken(env, userId);
  const url = new URL(`${DRIVE_API}/files`);
  url.searchParams.set("q", "trashed=false");
  url.searchParams.set("fields", "files(id,name,modifiedTime)");
  const r = await fetch(url, { headers:{ Authorization:`Bearer ${token}` }});
  if(!r.ok) throw new Error(`list ${r.status}`);
  return r.json();
}

export async function userSaveUrl(env, userId, fileUrl, name){
  const token = await getUserAccessToken(env, userId);
  const f = await fetch(fileUrl);
  if(!f.ok) throw new Error(`fetch ${f.status}`);
  const buf = await f.arrayBuffer();

  const meta = { name };
  const head =
    `--x\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--x\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`;
  const full = new Blob([head, new Uint8Array(buf), "\r\n--x--"]);

  const r = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
    method:"POST",
    headers:{
      Authorization:`Bearer ${token}`,
      "Content-Type":"multipart/related; boundary=x",
    },
    body: full,
  });
  const j = await r.json();
  if(!r.ok) throw new Error(`upload ${r.status}: ${JSON.stringify(j)}`);
  return j;
}