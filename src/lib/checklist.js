import { kvGetJSON, kvPutJSON } from "./kv.js";

const LIST_KEY = "checklist:main";
const SEQ_KEY = "checklist:seq";
const TTL = 60 * 60 * 24 * 90; // 90 днів (оновлюється при кожній зміні)

async function getSeq(env) {
  const cur = parseInt((await env.SENTI_CACHE.get(SEQ_KEY)) || "0", 10);
  const next = cur + 1;
  await env.SENTI_CACHE.put(SEQ_KEY, String(next), { expirationTtl: TTL });
  return next;
}

export async function getChecklist(env) {
  if (!env.SENTI_CACHE) return [];
  return (await kvGetJSON(env.SENTI_CACHE, LIST_KEY, [])) || [];
}

async function saveChecklist(env, list) {
  await kvPutJSON(env.SENTI_CACHE, LIST_KEY, list, TTL);
}

export async function addItem(env, text, authorId) {
  const list = await getChecklist(env);
  const id = await getSeq(env);
  const item = { id, text: String(text).trim(), done: false, ts: Date.now(), authorId };
  list.push(item);
  await saveChecklist(env, list);
  return item;
}

export async function markDone(env, id, done = true) {
  const list = await getChecklist(env);
  const idx = list.findIndex(i => i.id === id);
  if (idx === -1) return false;
  list[idx].done = !!done;
  await saveChecklist(env, list);
  return true;
}

export async function removeItem(env, id) {
  const list = await getChecklist(env);
  const n = list.length;
  const filtered = list.filter(i => i.id !== id);
  if (filtered.length === n) return false;
  await saveChecklist(env, filtered);
  return true;
}

export async function clearChecklist(env) {
  await saveChecklist(env, []);
  return true;
}

export function toMarkdown(list) {
  if (!list?.length) return "# ✅ Senti Checklist\n\n(порожньо)\n";
  const lines = list
    .sort((a, b) => a.id - b.id)
    .map(i => `- [${i.done ? "x" : " "}] (${i.id}) ${i.text}`);
  return `# ✅ Senti Checklist\n\n${lines.join("\n")}\n`;
}