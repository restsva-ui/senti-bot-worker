// src/lib/kvLearnQueue.js
// Зберігаємо черги в STATE_KV під префіксом learn:*
// - learn:users -> ["784869835", ...] — довідник користувачів, що колись додавали елементи
// - learn:user:<id> -> [{ id, type, url, name, when, status, report? }, ...]
// - learn:sys -> [{ id, type, url, name, when, status, report? }, ...]

const PREFIX = "learn";
const keyUser = (uid) => `${PREFIX}:user:${uid}`;
const keySys = () => `${PREFIX}:sys`;
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
    type,
    url,
    name: name || url,
    when: Date.now(),
    status: "queued",
  };
}

// ---------- public API ----------

export async function enqueueLearn(env, userId, { url, name, type = "url" }) {
  const key = keyUser(userId);
  const arr = await readJSON(env.STATE_KV, key, []);
  arr.push(makeItem({ url, name, type }));
  await writeJSON(env.STATE_KV, key, arr);

  // пам'ятаємо користувача
  const ukey = keyUsers();
  const users = await readJSON(env.STATE_KV, ukey, []);
  if (!users.includes(String(userId))) {
    users.push(String(userId));
    await writeJSON(env.STATE_KV, ukey, users);
  }
}

export async function enqueueSystemLearn(env, { url, name, type = "url" }) {
  const key = keySys();
  const arr = await readJSON(env.STATE_KV, key, []);
  arr.push(makeItem({ url, name, type }));
  await writeJSON(env.STATE_KV, key, arr);
}

export async function listLearn(env, userId) {
  return await readJSON(env.STATE_KV, keyUser(userId), []);
}

export async function listSystemLearn(env) {
  return await readJSON(env.STATE_KV, keySys(), []);
}

export async function clearLearn(env, userId) {
  await writeJSON(env.STATE_KV, keyUser(userId), []);
}

export async function markAsProcessing(env, scope, id) {
  const key = scope === "sys" ? keySys() : keyUser(scope.replace("user:", ""));
  const arr = await readJSON(env.STATE_KV, key, []);
  const i = arr.findIndex((x) => x.id === id);
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
  const i = arr.findIndex((x) => x.id === id);
  if (i >= 0) {
    arr[i].status = ok ? "done" : "failed";
    if (report) arr[i].report = report;
    await writeJSON(env.STATE_KV, key, arr);
    return arr[i];
  }
  return null;
}

// простий обробник черги (заглушка; інтегруйте свою логіку "читання/векторизації" тут)
async function processItem(env, item) {
  // TODO: тут можна підтягнути сторінку/текст, скласти короткий звіт, записати у LIKES_KV або DIALOG_KV
  return {
    summary: "Processed item",
    title: item.name,
    url: item.url,
    words: 0,
  };
}

export async function runLearnOnce(env, { userId = null } = {}) {
  let processed = [];

  // 1) системна черга
  const sys = await listSystemLearn(env);
  for (const it of sys.filter((x) => x.status === "queued")) {
    await markAsProcessing(env, "sys", it.id);
    const rep = await processItem(env, it).catch((e) => ({ error: String(e) }));
    await markAsDone(env, "sys", it.id, rep, !rep?.error);
    processed.push({ scope: "sys", id: it.id, ok: !rep?.error });
  }

  // 2) користувацькі (або конкретний userId, або всі)
  const users = userId
    ? [String(userId)]
    : await readJSON(env.STATE_KV, keyUsers(), []);

  for (const uid of users) {
    const items = await listLearn(env, uid);
    for (const it of items.filter((x) => x.status === "queued")) {
      await markAsProcessing(env, `user:${uid}`, it.id);
      const rep = await processItem(env, it).catch((e) => ({ error: String(e) }));
      await markAsDone(env, `user:${uid}`, it.id, rep, !rep?.error);
      processed.push({ scope: `user:${uid}`, id: it.id, ok: !rep?.error });
    }
  }

  return { ok: true, processed };
}
