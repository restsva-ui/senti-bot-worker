const keyFor = (chatId) => `todo:${chatId}`;

export async function loadTodos(env, chatId) {
  try {
    const raw = await env.TODO_KV.get(keyFor(chatId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveTodos(env, chatId, list) {
  try {
    await env.TODO_KV.put(keyFor(chatId), JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export async function addTodo(env, chatId, text) {
  const list = await loadTodos(env, chatId);
  const exists = list.some((x) => x.text.toLowerCase() === text.toLowerCase());
  if (exists) return { added: false, list };
  const item = { text, ts: Date.now() };
  list.push(item);
  await saveTodos(env, chatId, list);
  return { added: true, list };
}

export async function removeTodoByIndex(env, chatId, idx1) {
  const list = await loadTodos(env, chatId);
  const i = idx1 - 1;
  if (i < 0 || i >= list.length) return { ok: false, list };
  const [removed] = list.splice(i, 1);
  await saveTodos(env, chatId, list);
  return { ok: true, removed, list };
}

export function formatTodos(list) {
  if (!list.length) return "✅ Чек-лист порожній.";
  return "📝 Чек-лист:\n" + list.map((x, i) => `${i + 1}. ${x.text}`).join("\n");
}