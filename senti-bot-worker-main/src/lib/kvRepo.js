// src/lib/kvRepo.js
// Просте сховище "міні-Git" на KV: архіви версій + поточні файли + маніфест.
// Без розпакування ZIP (зберігаємо як Base64), але з повним редагуванням файлів у "current".

const PREFIX = {
  manifest: "repo/index.json",
  active:   "repo/active",                // id активної версії
  archives: "repo/archive/",              // repo/archive/<ts>__<name>.zip => base64
  files:    "repo/fs/current/",           // repo/fs/current/<path>
};

function ensureKv(env) {
  const kv = env.TODO_KV;
  if (!kv) throw new Error("TODO_KV binding missing (wrangler.toml)!");
  return kv;
}

async function readJSON(kv, key, fallback) {
  const s = await kv.get(key);
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

async function writeJSON(kv, key, obj) {
  await kv.put(key, JSON.stringify(obj));
}

function nowISO() { return new Date().toISOString(); }

export async function getManifest(env) {
  const kv = ensureKv(env);
  const m = await readJSON(kv, PREFIX.manifest, { versions: [] });
  if (!Array.isArray(m.versions)) m.versions = [];
  return m;
}

export async function setManifest(env, manifest) {
  const kv = ensureKv(env);
  await writeJSON(kv, PREFIX.manifest, manifest);
}

export async function getActiveVersion(env) {
  const kv = ensureKv(env);
  return await kv.get(PREFIX.active);
}

export async function setActiveVersion(env, id) {
  const kv = ensureKv(env);
  await kv.put(PREFIX.active, String(id || ""));
}

export async function listVersions(env) {
  const m = await getManifest(env);
  const active = (await getActiveVersion(env)) || "";
  return m.versions.map(v => ({ ...v, active: v.id === active }));
}

// ---- Архіви ----
// Зберігаємо ZIP як Base64. Без розпаковки (спростить ліміти й код).
export async function saveRepoArchive(env, file, comment="") {
  const kv = ensureKv(env);
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("Invalid file upload");
  }
  const buf = await file.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));

  const safeName = (file.name || "archive.zip").replace(/[^\w.\-]+/g, "_");
  const id = nowISO(); // унікальний id версії (ISO)
  const key = PREFIX.archives + `${id}__${safeName}`;

  await kv.put(key, b64);

  const m = await getManifest(env);
  m.versions.unshift({
    id,
    name: safeName,
    key,
    createdAt: id,
    comment: String(comment || ""),
    status: "unknown" // ok | fail | unknown
  });
  await setManifest(env, m);

  // за замовчуванням робимо новий архів активним
  await setActiveVersion(env, id);

  return { id, key, name: safeName };
}

export async function getArchiveBase64(env, key) {
  const kv = ensureKv(env);
  return await kv.get(key);
}

export async function deleteVersion(env, id) {
  const kv = ensureKv(env);
  const m = await getManifest(env);
  const idx = m.versions.findIndex(v => v.id === id);
  if (idx === -1) return false;

  const v = m.versions[idx];
  if (v?.key) await kv.delete(v.key);
  m.versions.splice(idx, 1);
  await setManifest(env, m);

  const active = await getActiveVersion(env);
  if (active === id) await setActiveVersion(env, m.versions[0]?.id || "");
  return true;
}

export async function setVersionStatus(env, id, status /* ok | fail | unknown */) {
  const m = await getManifest(env);
  const v = m.versions.find(x => x.id === id);
  if (v) { v.status = status; await setManifest(env, m); }
  return !!v;
}

// ---- Поточні файли (editable) ----
function normalizePath(p) {
  const s = String(p || "").replace(/^\/+/, "");
  if (!s) throw new Error("path required");
  return s;
}

export async function writeRepoFile(env, path, content) {
  const kv = ensureKv(env);
  const p = normalizePath(path);
  await kv.put(PREFIX.files + p, String(content ?? ""));
  return true;
}

export async function readRepoFile(env, path) {
  const kv = ensureKv(env);
  const p = normalizePath(path);
  return (await kv.get(PREFIX.files + p)) ?? "";
}

export async function listRepoFiles(env, prefix="") {
  const kv = ensureKv(env);
  const pre = PREFIX.files + normalizePath(prefix).replace(/\/?$/, "/");
  const { keys } = await kv.list({ prefix: pre });
  return keys.map(k => k.name.replace(PREFIX.files, ""));
}

export async function deleteRepoFile(env, path) {
  const kv = ensureKv(env);
  const p = normalizePath(path);
  await kv.delete(PREFIX.files + p);
  return true;
}