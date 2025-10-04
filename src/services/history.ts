// src/services/history.ts
// Невеликий, безпечний для мобільного деплою менеджер історії діалогів у KV (SENTI_CACHE).

export type ChatRole = "system" | "user" | "assistant";

export interface ChatTurn {
  role: ChatRole;
  content: string;
  ts: number; // unix ms
}

export interface HistoryEnv {
  SENTI_CACHE?: KVNamespace;
}

/** Ключ у KV */
function key(chatId: number | string) {
  return `hist:${chatId}`;
}

/** Максимуми за замовчуванням (можеш змінити цифри під себе) */
const DEFAULT_MAX_TURNS = 12;      // скільки пар повідомлень тримати максимум
const MAX_TOTAL_CHARS   = 8000;    // загальний «буфер символів», щоб не роздуватись
const DEFAULT_TTL_SEC   = 60 * 60 * 24 * 7; // 7 днів

/** Завантажити історію з KV (якщо нема — пуста) */
export async function loadHistory(env: HistoryEnv, chatId: number | string): Promise<ChatTurn[]> {
  if (!env.SENTI_CACHE) return [];
  try {
    const raw = await env.SENTI_CACHE.get(key(chatId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Безпека парсингу
    return arr
      .filter((x: any) => x && typeof x.content === "string" && (x.role === "user" || x.role === "assistant" || x.role === "system"))
      .map((x: any) => ({ role: x.role as ChatRole, content: x.content, ts: Number(x.ts) || Date.now() }));
  } catch {
    return [];
  }
}

/** Зберегти історію в KV із триманням розміру */
export async function saveHistory(
  env: HistoryEnv,
  chatId: number | string,
  turns: ChatTurn[],
  ttlSec = DEFAULT_TTL_SEC
): Promise<void> {
  if (!env.SENTI_CACHE) return;
  const trimmed = trimTurns(turns, DEFAULT_MAX_TURNS, MAX_TOTAL_CHARS);
  await env.SENTI_CACHE.put(key(chatId), JSON.stringify(trimmed), { expirationTtl: ttlSec });
}

/** Додати одне повідомлення та автотримінг */
export async function appendHistory(
  env: HistoryEnv,
  chatId: number | string,
  turn: ChatTurn,
  ttlSec = DEFAULT_TTL_SEC
): Promise<void> {
  const cur = await loadHistory(env, chatId);
  cur.push(turn);
  await saveHistory(env, chatId, cur, ttlSec);
}

/** Жорсткий тримінг за кількістю та сумою символів */
export function trimTurns(turns: ChatTurn[], maxTurns: number, maxChars: number): ChatTurn[] {
  let arr = turns.slice(-maxTurns); // спершу по кількості
  // потім по символах (із хвоста, бо «свіжіше» важливіше)
  let total = 0;
  const out: ChatTurn[] = [];
  for (let i = arr.length - 1; i >= 0; i--) {
    const t = arr[i];
    total += (t?.content?.length || 0);
    if (total > maxChars) break;
    out.push(t);
  }
  return out.reverse();
}

/** Конвертер в «messages» для chat-моделей */
export function toChatMessages(turns: ChatTurn[], systemPrompt?: string) {
  const msgs: { role: "system" | "user" | "assistant"; content: string }[] = [];
  if (systemPrompt?.trim()) msgs.push({ role: "system", content: systemPrompt.trim() });
  for (const t of turns) {
    msgs.push({ role: t.role, content: t.content });
  }
  return msgs;
}