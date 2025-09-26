// src/commands/likepanel.ts
// Легка та надійна реалізація панелі лайків з урахуванням 1 юзер -> 1 голос

import { sendMessage, editMessageReplyMarkup } from "../telegram/api";
import { getEnv } from "../config"; // у нас є getEnv() після останніх правок

type TGUser = { id: number };
type TGMessage = { message_id: number; chat: { id: number } };
type TGCallbackQuery = { id: string; from: TGUser; message?: TGMessage; data?: string };
type TGUpdate = { callback_query?: TGCallbackQuery };

type Counters = { like: number; dislike: number };

const PANEL_ID = "global"; // одна панель на бота; при бажанні можна `${chatId}`

function cKey(panelId: string) {
  return `likes:${panelId}`;                       // JSON { like, dislike }
}
function uKey(panelId: string, userId: number) {
  return `likes:${panelId}:u:${userId}`;          // "up" | "down"
}

function buttons() {
  return {
    inline_keyboard: [
      [{ text: "👍", callback_data: "like:up" }, { text: "👎", callback_data: "like:down" }],
    ],
  };
}

async function readJSON<T>(ns: KVNamespace, key: string, fallback: T): Promise<T> {
  const raw = await ns.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJSON(ns: KVNamespace, key: string, val: unknown): Promise<void> {
  await ns.put(key, JSON.stringify(val));
}

// Публічна команда: показати панель з поточними значеннями
export async function likepanel(chatId: number) {
  const env = getEnv();
  const ns = env.KV;
  const counters = await readJSON<Counters>(ns, cKey(PANEL_ID), { like: 0, dislike: 0 });
  const text = `Оцінки: 👍 ${counters.like} | 👎 ${counters.dislike}`;
  await sendMessage(chatId, text, buttons());
}

// Обробник callback з кнопок 👍/👎
// Повертає true, якщо це наш callback і ми його обробили
export async function handleLikeCallback(update: TGUpdate): Promise<boolean> {
  const cq = update.callback_query;
  if (!cq || !cq.data) return false;
  if (!cq.data.startsWith("like:")) return false;

  const env = getEnv();
  const ns = env.KV;

  const choice = cq.data.split(":")[1]; // "up" | "down"
  if (choice !== "up" && choice !== "down") return false;

  // Ідентифікатори
  const panelId = PANEL_ID;
  const chatId = cq.message?.chat.id;
  if (!chatId) return true; // чужі callback-и ігноруємо без помилки

  // Поточний стан
  const counters = await readJSON<Counters>(ns, cKey(panelId), { like: 0, dislike: 0 });
  const prev = (await ns.get(uKey(panelId, cq.from.id))) as "up" | "down" | null;

  // Нова дія == попередній голос -> нічого не змінюємо
  if (prev === choice) {
    // просто освіжимо клавіатуру, щоб не було “зависань”
    if (cq.message) {
      await editMessageReplyMarkup(chatId, cq.message.message_id, buttons()).catch(() => {});
    }
    return true;
  }

  // Забезпечимо коректні межі
  const safe = (n: number) => (n < 0 ? 0 : n);

  // Зняти попередній голос, якщо був
  if (prev === "up") counters.like = safe(counters.like - 1);
  if (prev === "down") counters.dislike = safe(counters.dislike - 1);

  // Поставити новий голос
  if (choice === "up") counters.like = safe(counters.like + 1);
  else counters.dislike = safe(counters.dislike + 1);

  // Зберегти
  await writeJSON(ns, cKey(panelId), counters);
  await ns.put(uKey(panelId, cq.from.id), choice);

  // Пере-показати панель (простий шлях без editMessageText)
  const text = `Оцінки: 👍 ${counters.like} | 👎 ${counters.dislike}`;
  await sendMessage(chatId, text, buttons());

  return true;
}