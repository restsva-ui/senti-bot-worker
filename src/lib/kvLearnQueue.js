// src/lib/kvLearnQueue.js
const PREFIX = "learn";
const keyUser = (uid) => `${PREFIX}:user:${uid}`;
const keySys  = () => `${PREFIX}:sys`;
const keyUsers = () => `${PREFIX}:users`;

async function readJSON(KV, key, def) {
  const v = await KV.get(key);
  if (!v) return def;
  try { return JSON.parse(v); } catch { return def; }
}
async function writeJSON(KV, key, val) {
  await KV.put(key, JSON.stringify(val));
}

function makeItem({ url, name, type = "url" }) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type, url,
    name: name || url,
    when: Date.now(),
    status: "queued",
  };
}

// ---- API ----
export async function enqueueLearn(env, userId, { url, name, type = "url" }) {
  const k = keyUser(userId);
  const arr = await readJSON(env.STATE_KV, k, []);
  arr.push(makeItem({ url, name, type }));
  await writeJSON(env.STATE_KV, k, arr);

  const uk = keyUsers();
  const users = await readJSON(env.STATE_KV, uk, []);
  const uid = String(userId);
  if (!users.includes(uid)) {
    users.push(uid);
    await writeJSON(env.STATE_KV, uk, users);
  }
}
export async function enqueueSystemLearn(env, { url, name, type = "url" }) {
  const k = keySys();
  const arr = await readJSON(env.STATE_KV, k, []);
  arr.push(makeItem({ url, name, type }));
  await writeJSON(env.STATE_KV, k, arr);
}
export async function listLearn(env, userId) { return await readJSON(env.STATE_KV, keyUser(userId), []); }
export async function listSystemLearn(env) { return await readJSON(env.STATE_KV, keySys(), []); }
export async function clearLearn(env, userId) { await writeJSON(env.STATE_KV, keyUser(userId), []); }

export async function markAsProcessing(env, scope, id) {
  const key = scope === "sys" ? keySys() : keyUser(scope.replace("user:", ""));
  const arr = await readJSON(env.STATE_KV, key, []);
  const i = arr.findIndex(x => x.id === id);
  if (i >= 0) {
    arr[i].status = "processing";
    await writeJSON(env.STATE_KV, key, arr);
    return arr[i];
  }
  return null;
}
export async function markAsDone(env, scope, id, report = null, ok = true) {
  const key = scope === "sys" ? keySys() : keyUser(scope.replace("user:", ""));
  const arr = await readJSON(env.STATE_KV, key, []);
  const i = arr.findIndex(x => x.id === id);
  if (i >= 0) {
    arr[i].status = ok ? "done" : "failed";
    if (report) arr[i].report = report;
    await writeJSON(env.STATE_KV, key, arr);
    return arr[i];
  }
  return null;
}

// Заглушка обробки елемента (підключіть свою реальну логіку).
async function processItem(env, item) {
  return { summary: "Processed item", title: item.name, url: item.url, words: 0 };
}

// Одноразовий прогін усієї черги
export async function runLearnOnce(env, { userId = null } = {}) {
  const processed = [];

  // системна
  for (const it of await listSystemLearn(env)) {
    if (it.status !== "queued") continue;
    await markAsProcessing(env, "sys", it.id);
    const rep = await processItem(env, it).catch(e => ({ error: String(e) }));
    await markAsDone(env, "sys", it.id, rep, !rep?.error);
    processed.push({ scope: "sys", id: it.id, ok: !rep?.error });
  }

  // користувачі
  const users = userId
    ? [String(userId)]
    : await readJSON(env.STATE_KV, keyUsers(), []);
  for (const uid of users) {
    for (const it of await listLearn(env, uid)) {
      if (it.status !== "queued") continue;
      await markAsProcessing(env, `user:${uid}`, it.id);
      const rep = await processItem(env, it).catch(e => ({ error: String(e) }));
      await markAsDone(env, `user:${uid}`, it.id, rep, !rep?.error);
      processed.push({ scope: `user:${uid}`, id: it.id, ok: !rep?.error });
    }
  }

  return { ok: true, processed };
}
