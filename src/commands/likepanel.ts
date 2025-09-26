// src/commands/likepanel.ts
// Надійна панель лайків: 1 користувач -> 1 голос (перемикання між 👍/👎 переносить голос)

import { sendMessage } from "../telegram/api";
import { getEnv } from "../config";

type TGUser = { id: number };
type TGMessage = { message_id: number; chat: { id: number } };
type TGCallbackQuery = { id: string; from: TGUser; message?: TGMessage; data?: string };
type TGUpdate = { callback_query?: TGCallbackQuery };

type Counters = { like: number; dislike: number };

const PANEL_ID = "global"; // одна спільна панель; за потреби зроби `${chatId}`

function cKey(panelId: string) {
  return `likes:${panelId}`; // JSON { like, dislike }
}
function uKey(panelId: string, userId: number) {
  return `likes:${panelId}:u:${userId}`; // "up" | "down"
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
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
async function writeJSON(ns: KVNamespace, key: string, val: unknown): Promise<void> {
  await ns.put(key, JSON.stringify(val));
}

export async function likepanel(chatId: number) {
  const { KV } = getEnv();
  const counters = await readJSON<Counters>(KV, cKey(PANEL_ID), { like: 0, dislike: 0 });
  const text = `Оцінки: 👍 ${counters.like} | 👎 ${counters.dislike}`;
  await sendMessage(chatId, text, buttons());
}

// Повертає true, якщо callback належить панелі лайків і оброблений
export async function handleLikeCallback(update: TGUpdate): Promise<boolean> {
  const cq = update.callback_query;
  if (!cq || !cq.data) return false;
  if (!cq.data.startsWith("like:")) return false;

  const choice = cq.data.split(":")[1]; // "up" | "down"
  if (choice !== "up" && choice !== "down") return false;

  const chatId = cq.message?.chat.id;
  if (!chatId) return true; // нічого не робимо, але в роутері callback вже “answer”-иться

  const { KV } = getEnv();
  const panelId = PANEL_ID;

  const counters = await readJSON<Counters>(KV, cKey(panelId), { like: 0, dislike: 0 });
  const prev = (await KV.get(uKey(panelId, cq.from.id))) as "up" | "down" | null;

  // Такий самий вибір — нічого не змінюємо
  if (prev === choice) return true;

  const safe = (n: number) => (n < 0 ? 0 : n);
  if (prev === "up") counters.like = safe(counters.like - 1);
  if (prev === "down") counters.dislike = safe(counters.dislike - 1);

  if (choice === "up") counters.like = safe(counters.like + 1);
  else counters.dislike = safe(counters.dislike + 1);

  await writeJSON(KV, cKey(panelId), counters);
  await KV.put(uKey(panelId, cq.from.id), choice);

  const text = `Оцінки: 👍 ${counters.like} | 👎 ${counters.dislike}`;
  await sendMessage(chatId, text, buttons());
  return true;
}