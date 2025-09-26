import { sendMessage } from "../telegram/api";

// Ключі в KV: likes:{chatId}, votes:{chatId}:{userId}  (щоб 1 користувач = 1 голос)
type Likes = { like: number; dislike: number };

function empty(): Likes { return { like: 0, dislike: 0 }; }

export async function likepanel(chatId: number) {
  const state = await getLikes(chatId);
  const replyMarkup = {
    inline_keyboard: [
      [{ text: "👍", callback_data: "like" }, { text: "👎", callback_data: "dislike" }],
    ],
  };
  await sendMessage(chatId, `Оцінки: 👍 ${state.like} | 👎 ${state.dislike}`, replyMarkup);
}

export async function handleLikeCallback(update: any): Promise<boolean> {
  const cq = update.callback_query;
  if (!cq || !cq.data || !cq.message?.chat?.id || !cq.from?.id) return false;

  const chatId = cq.message.chat.id as number;
  const userId = cq.from.id as number;
  const data = cq.data as string;

  if (data !== "like" && data !== "dislike") return false;

  // читаємо поточний голос користувача
  const userKey = `votes:${chatId}:${userId}`;
  const prev = await KV.get(userKey); // "like" | "dislike" | null

  if (prev === data) {
    // нічого не міняємо — вже проголосував
  } else {
    // оновлюємо агрегати
    const s = await getLikes(chatId);
    if (prev === "like") s.like--;
    if (prev === "dislike") s.dislike--;
    if (data === "like") s.like++;
    if (data === "dislike") s.dislike++;
    await KV.put(`likes:${chatId}`, JSON.stringify(s));
    await KV.put(userKey, data);
  }

  // показати свіжі числа
  const state = await getLikes(chatId);
  await sendMessage(chatId, `Оцінки: 👍 ${state.like} | 👎 ${state.dislike}`);
  return true;
}

async function getLikes(chatId: number): Promise<Likes> {
  const raw = await KV.get(`likes:${chatId}`);
  if (!raw) return empty();
  try { return JSON.parse(raw) as Likes; } catch { return empty(); }
}