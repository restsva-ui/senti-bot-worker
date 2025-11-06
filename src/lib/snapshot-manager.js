// src/lib/snapshot-manager.js
// Зберігання "базового" снепшоту та історії у STATE_KV
import { loadTodos, saveTodos } from "./todo.js";

const KEY_BASE = "snapshot:base";       // { sha, url, note, createdTs }
const KEY_HISTORY = "snapshot:history"; // [{ sha, url, note, createdTs }...], останні 20

async function kvGetJSON(kv, key, fallback) {
  try {
    const v = await kv.get(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

async function kvPutJSON(kv, key, obj) {
  await kv.put(key, JSON.stringify(obj));
}

export async function getBaseSnapshot(env) {
  return await kvGetJSON(env.STATE_KV, KEY_BASE, null);
}

export async function setBaseSnapshot(env, { sha, url, note }) {
  const snap = {
    sha: sha || "",
    url: url || "",
    note: note || "",
    createdTs: Date.now(),
  };
  await kvPutJSON(env.STATE_KV, KEY_BASE, snap);
  // також кидаємо у історію
  await appendHistory(env, snap);
  return snap;
}

export async function appendHistory(env, entry) {
  const hist = (await kvGetJSON(env.STATE_KV, KEY_HISTORY, [])) || [];
  hist.unshift({
    sha: entry.sha || "",
    url: entry.url || "",
    note: entry.note || "",
    createdTs: entry.createdTs || Date.now(),
  });
  if (hist.length > 20) hist.length = 20;
  await kvPutJSON(env.STATE_KV, KEY_HISTORY, hist);
  return hist;
}

export async function getHistory(env) {
  return (await kvGetJSON(env.STATE_KV, KEY_HISTORY, [])) || [];
}

/**
 * Додає або оновлює пункт у чек-лісті виду:
 * "FUNDAMENTAL SNAPSHOT → sha <sha> | <url>"
 * Якщо пункт уже існує — перезаписує його текст; якщо ні — додає на початок.
 */
export async function upsertSnapshotTodo(env, ownerChatId, snap) {
  const list = await loadTodos(env, ownerChatId); // [{text, ts}]
  const line = `FUNDAMENTAL SNAPSHOT → sha ${snap.sha || "—"} | ${snap.url || "—"}`;

  // шукати існуючий пункт, що починається з "FUNDAMENTAL SNAPSHOT →"
  const idx = list.findIndex((x) =>
    String(x.text || "").toLowerCase().startsWith("fundamental snapshot →")
  );

  if (idx >= 0) {
    list[idx].text = line;
    list[idx].ts = Date.now();
  } else {
    // додаємо на початок
    list.unshift({ text: line, ts: Date.now() });
  }

  await saveTodos(env, ownerChatId, list);
  return { updated: idx >= 0, total: list.length, line };
}