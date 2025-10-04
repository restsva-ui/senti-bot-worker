// src/services/history.ts
// Легка пам'ять чату у KV (SENTI_CACHE)

export interface MemoryEnv {
  SENTI_CACHE?: KVNamespace;
}

export type Msg = { role: "user" | "assistant" | "system"; content: string; ts?: number };

// Скільки останніх повідомлень тримаємо (разом user+assistant)
const MAX_TURNS = 16;

// Ключ у KV
function convKey(chatId: number | string) {
  return `conv:${chatId}`;
}

/** Зчитати історію (може бути порожньою) */
export async function loadHistory(env: MemoryEnv, chatId: number | string): Promise<Msg[]> {
  if (!env.SENTI_CACHE) return [];
  const raw = await env.SENTI_CACHE.get(convKey(chatId));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as Msg[]) : [];
  } catch {
    return [];
  }
}

/** Додати нову пару (user → assistant) і обрізати до MAX_TURNS */
export async function saveTurn(
  env: MemoryEnv,
  chatId: number | string,
  userText: string,
  assistantText: string
): Promise<void> {
  if (!env.SENTI_CACHE) return;
  const list = await loadHistory(env, chatId);

  if (userText?.trim()) list.push({ role: "user", content: userText.trim(), ts: Date.now() });
  if (assistantText?.trim()) list.push({ role: "assistant", content: assistantText.trim(), ts: Date.now() });

  // залишаємо лише останні MAX_TURNS
  const extra = Math.max(0, list.length - MAX_TURNS);
  const trimmed = extra > 0 ? list.slice(extra) : list;

  // TTL 7 днів
  await env.SENTI_CACHE.put(convKey(chatId), JSON.stringify(trimmed), { expirationTtl: 60 * 60 * 24 * 7 });
}

/** Утиліта: побудувати messages (історія + поточний prompt) */
export function buildMessages(history: Msg[], prompt: string): Msg[] {
  return [...history, { role: "user", content: prompt }];
}