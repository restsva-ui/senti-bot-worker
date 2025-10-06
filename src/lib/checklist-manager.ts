import { loadTodos, saveTodos } from "./todo.js";

const LAST_SYNC_KEY = (chatId) => `checklist:last_sync:${chatId}`;

// Обов'язкові правила для моєї самодисципліни
const REQUIRED_RULES = [
  "RULE: Завжди надавати повний файл після змін.",
  "RULE: Перед змінами перевіряти зв’язки між файлами та конфігами.",
  "RULE: Вести лог змін у STATE_KV (file:<name>, hash, ts).",
  "RULE: Перевіряти доступність KV та біндінги перед деплоєм.",
  "RULE: Пам’ятати, що Шеф працює з телефону — мінімізувати кроки.",
];

function normalizeList(rawList) {
  // 1) trim/очистка
  let list = (Array.isArray(rawList) ? rawList : []).map((x) => ({
    text: String(x.text ?? x).trim(),
    ts: x.ts ?? Date.now(),
  })).filter((x) => x.text.length > 0);

  // 2) дедуп (без регістру)
  const seen = new Set();
  list = list.filter((x) => {
    const key = x.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 3) додати відсутні RULES зверху
  const have = new Set(list.map((x) => x.text.toLowerCase()));
  const rulesToAdd = REQUIRED_RULES.filter(r => !have.has(r.toLowerCase())).map(r => ({ text: r, ts: Date.now() }));
  if (rulesToAdd.length) list = [...rulesToAdd, ...list];

  return { list, addedRules: rulesToAdd.map(r => r.text) };
}

export async function syncOnce(env, chatId) {
  const prev = await loadTodos(env, chatId);
  const { list, addedRules } = normalizeList(prev);
  let changed = false;
  if (JSON.stringify(list) !== JSON.stringify(prev)) {
    await saveTodos(env, chatId, list);
    changed = true;
  }
  // позначимо timestamp останньої синхронізації
  try {
    await env.STATE_KV.put(LAST_SYNC_KEY(chatId), String(Date.now()));
  } catch (_) {}

  return { changed, addedRules, count: list.length };
}