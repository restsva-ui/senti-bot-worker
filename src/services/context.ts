// Стислий контекст у KV: останні N реплік на чат
export type ChatMsg = { role: "system" | "user" | "assistant"; content: string; ts?: number };

const KEY = (chatId: number | string) => `ctx:${chatId}`;
const MAX_TURNS_DEFAULT = 12;         // зміни на 5/8/12 як хочеш
const TTL_SEC_DEFAULT = 60 * 60 * 6;  // 6 годин зберігання історії

export interface ContextEnv {
  SENTI_CACHE?: KVNamespace;
}

export async function loadHistory(env: ContextEnv, chatId: number | string): Promise<ChatMsg[]> {
  if (!env.SENTI_CACHE) return [];
  try {
    const raw = await env.SENTI_CACHE.get(KEY(chatId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return arr.filter((m) => m && typeof m.content === "string" && m.content.trim());
    }
  } catch {}
  return [];
}

export async function saveHistory(
  env: ContextEnv,
  chatId: number | string,
  msgs: ChatMsg[],
  maxTurns = MAX_TURNS_DEFAULT,
  ttlSec = TTL_SEC_DEFAULT
) {
  if (!env.SENTI_CACHE) return;
  // тримаємо лише останні maxTurns повідомлень (користувач+асистент = 1-2 слоти)
  const compact = msgs.slice(-maxTurns);
  await env.SENTI_CACHE.put(KEY(chatId), JSON.stringify(compact), { expirationTtl: ttlSec });
}

export async function pushUser(env: ContextEnv, chatId: number | string, text: string) {
  const h = await loadHistory(env, chatId);
  h.push({ role: "user", content: text, ts: Date.now() });
  await saveHistory(env, chatId, h);
}

export async function pushAssistant(env: ContextEnv, chatId: number | string, text: string) {
  const h = await loadHistory(env, chatId);
  h.push({ role: "assistant", content: text, ts: Date.now() });
  await saveHistory(env, chatId, h);
}