// src/lib/drive.js
// Стабільна версія з підтримкою Service Account (JWT) + fallback на refresh_token.
// Додає діагностику режиму автентифікації і безпечні помилки.

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const TOKEN_URL  = "https://oauth2.googleapis.com/token";
const OAUTH_KEY = "google_oauth";

function nowSec(){ return Math.floor(Date.now()/1000); }

// ---------------- KV helpers ----------------
function ensureKv(env){
  if(!env.OAUTH_KV) throw new Error("OAUTH_KV binding missing");
  return env.OAUTH_KV;
}
async function readKvTokens(env){
  const raw = await ensureKv(env).get(OAUTH_KEY);
  if(!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
async function writeKvTokens(env, data){
  const kv = ensureKv(env);
  await kv.delete(OAUTH_KEY).catch(()=>{});
  await kv.put(OAUTH_KEY, JSON.stringify(data));
}

// ---------------- Base64URL utils ----------------
function b64u(input){
  return btoa(input).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
}
function b64uArr(buf){
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
  return b64u(bin);
}

// ---------------- Service Account (JWT) ----------------
async function serviceAccountAccessToken(env){
  const json = env.DRIVE_SERVICE_ACCOUNT;
  if(!json) throw new Error("Service account JSON missing in DRIVE_SERVICE_ACCOUNT");
  let sa;
  try { sa = typeof json === "string" ? JSON.parse(json) : json; }
  catch { throw new Error("DRIVE_SERVICE_ACCOUNT is not valid JSON"); }

  const clientEmail = sa.client_email;
  const privateKey = sa.private_key;
  if(!clientEmail || !privateKey) throw new Error("Service account JSON must contain client_email and private_key");

  // audience і scope
  const iat = nowSec();
  const exp = iat + 3600;
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/drive.file",
    aud: TOKEN_URL,
    iat, exp
    // НЕ додаємо "sub" — імперсонація не потрібна і зламається на особистому Gmail
  };

  const encHeader  = b64u(JSON.stringify(header));
  const encPayload = b64u(JSON.stringify(payload));
  const signingInput = `${encHeader}.${encPayload}`;

  // Імпорт ключа у WebCrypto
  const pem = privateKey.trim()
    .replace("-----BEGIN PRIVATE KEY-----","")
    .replace("-----END PRIVATE KEY-----","")
    .replace(/\s+/g,"");
  const der = Uint8Array.from(atob(pem), c=>c.charCodeAt(0)).buffer;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${b64uArr(sig)}`;

  const form = new URLSearchParams();
  form.set("grant_type","urn:ietf:params:oauth:grant-type:jwt-bearer");
  form.set("assertion", jwt);

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type":"application/x-www-form-urlencoded" },
    body: form
  });
  const d = await r.json().catch(()=> ({}));
  if(!r.ok || !d.access_token){
    throw new Error(`Service token exchange failed ${r.status}: ${JSON.stringify(d)}`);
  }
  return {
    access_token: d.access_token,
    auth_mode: "service",
    expiry: nowSec() + (d.expires_in || 3600) - 60
  };
}

// ---------------- Refresh Token (OAuth) ----------------
async function refreshAccessToken(env, refreshToken){
  if(!refreshToken) throw new Error("refreshAccessToken: refreshToken missing");
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const r = await fetch(TOKEN_URL, {
    method:"POST",
    headers:{ "Content-Type":"application/x-www-form-urlencoded" },
    body
  });
  const d = await r.json().catch(()=> ({}));
  if(!r.ok || !d.access_token){
    throw new Error(`Refresh ${r.status}: ${JSON.stringify(d)}`);
  }
  return {
    access_token: d.access_token,
    refresh_token: refreshToken,
    auth_mode: "refresh",
    expiry: nowSec() + (d.expires_in || 3600) - 60
  };
}

// ---------------- Access Token chooser ----------------
export async function getAccessToken(env){
  // 1) Сервісний акаунт
  if (env.DRIVE_SERVICE_ACCOUNT){
    const kv = await readKvTokens(env);
    if (kv?.auth_mode==="service" && kv.access_token && kv.expiry > nowSec()+10){
      return kv.access_token;
    }
    const next = await serviceAccountAccessToken(env);
    await writeKvTokens(env, next);
    return next.access_token;
  }

  // 2) KV refresh
  const kv = await readKvTokens(env);
  if (kv?.access_token && kv.expiry > nowSec()+10) return kv.access_token;
  if (kv?.refresh_token){
    const next = await refreshAccessToken(env, kv.refresh_token);
    await writeKvTokens(env, next);
    return next.access_token;
  }

  // 3) ENV refresh
  if (env.GOOGLE_REFRESH_TOKEN){
    const next = await refreshAccessToken(env, env.GOOGLE_REFRESH_TOKEN);
    await writeKvTokens(env, next);
    return next.access_token;
  }

  throw new Error("Google Drive auth missing — add DRIVE_SERVICE_ACCOUNT or run /auth");
}

// ---------------- Folder helper ----------------
function getFolderId(env){
  const raw = (env.DRIVE_FOLDER_ID || "").trim();
  if (raw && raw !== "." && raw.toLowerCase() !== "root") return raw;
  return "root";
}

// ---------------- Drive ops ----------------
export async function listFiles(env, token){
  const fid = getFolderId(env);
  const url = new URL(`${DRIVE_API}/files`);
  url.searchParams.set("q", `'${fid}' in parents and trashed=false`);
  url.searchParams.set("fields", "files(id,name,modifiedTime)");
  const r = await fetch(url, { headers:{ Authorization:`Bearer ${token}` }});
  if(!r.ok){
    const t = await r.text().catch(()=> "");
    throw new Error(`List ${r.status}: ${t}`);
  }
  return r.json();
}

async function ensureChecklist(env, token){
  const fid = getFolderId(env);
  const q = `name='senti_checklist.md' and '${fid}' in parents and trashed=false`;
  const search = await fetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id)`,
    { headers:{ Authorization:`Bearer ${token}` } }
  );
  const j = await search.json();
  if (j.files?.[0]) return j.files[0].id;

  const meta = { name:"senti_checklist.md", parents:[fid], mimeType:"text/markdown" };
  const body =
    `--x\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--x\r\n` +
    `Content-Type: text/markdown\r\n\r\n# Senti checklist\n\r\n--x--`;

  const r = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
    method:"POST",
    headers:{
      Authorization:`Bearer ${token}`,
      "Content-Type":"multipart/related; boundary=x"
    },
    body
  });
  const d = await r.json();
  if(!r.ok) throw new Error(`Create checklist ${r.status}: ${JSON.stringify(d)}`);
  return d.id;
}

export async function appendToChecklist(env, token, line){
  const id = await ensureChecklist(env, token);
  const cur = await fetch(`${DRIVE_API}/files/${id}?alt=media`, {
    headers:{ Authorization:`Bearer ${token}` }
  });
  let txt = cur.ok ? await cur.text() : "";
  const body = (txt || "# Senti checklist\n") + `- ${line}\n`;
  const r = await fetch(`${UPLOAD_API}/files/${id}?uploadType=media`, {
    method:"PATCH",
    headers:{
      Authorization:`Bearer ${token}`,
      "Content-Type":"text/markdown"
    },
    body
  });
  if(!r.ok){
    const t = await r.text().catch(()=> "");
    throw new Error(`Update ${r.status}: ${t}`);
  }
  return true;
}

export async function saveUrlToDrive(env, token, fileUrl, name){
  const fid = getFolderId(env);
  const f = await fetch(fileUrl);
  if(!f.ok) throw new Error(`Download ${f.status}`);
  const buf = await f.arrayBuffer();

  const meta = { name, parents:[fid] };
  const head =
    `--x\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--x\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`;
  const full = new Blob([head, new Uint8Array(buf), "\r\n--x--"]);

  const r = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
    method:"POST",
    headers:{
      Authorization:`Bearer ${token}`,
      "Content-Type":"multipart/related; boundary=x"
    },
    body: full
  });
  const j = await r.json();
  if(!r.ok) throw new Error(`Upload ${r.status}: ${JSON.stringify(j)}`);
  return j;
}

// Compatibility helpers
export async function drivePing(env, tokenOpt){
  const token = tokenOpt || (await getAccessToken(env));
  const files = await listFiles(env, token);
  return { ok:true, filesCount: files.files?.length || 0 };
}
export async function driveList(env, tokenOpt){
  const token = tokenOpt || (await getAccessToken(env));
  return listFiles(env, token);
}
export const driveListLatest = listFiles;
export const driveSaveFromUrl = saveUrlToDrive;
export const driveAppendLog   = appendToChecklist;