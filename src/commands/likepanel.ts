import { KVns } from "../config";
import { sendMessage } from "../telegram/api";

// 1 користувач = 1 активний голос на чат
type Likes = { like: number; dislike: number };
const empty = (): Likes => ({ like: 0, dislike: 0 });

export async function likepanel(chatId: number) {
  const s = await getLikes(chatId);
  const replyMarkup = {
    inline_keyboard: [
      [{ text: "👍", callback_data: "like" }, { text: "👎", callback_data: "dislike" }],
    ],
  };
  await sendMessage(chatId, `Оцінки: 👍 ${s.like} | 👎 ${s.dislike}`, replyMarkup);
}

export async function handleLikeCallback(update: any): Promise<boolean> {
  const cq = update.callback_query;
  if (!cq?.data || !cq.message?.chat?.id || !cq.from?.id) return false;

  const chatId = cq.message.chat.id as number;
  const userId = cq.from.id as number;
  const data = String(cq.data);

  if (data !== "like" && data !== "dislike") return false;

  const kv = KVns();
  const votesKey = `votes:${chatId}:${userId}`;
  const likesKey = `likes:${chatId}`;

  const prev = await kv.get(votesKey); // "like" | "dislike" | null
  if (prev !== data) {
    const s = await getLikes(chatId);
    if (prev === "like") s.like--;
    if (prev === "dislike") s.dislike--;
    if (data === "like") s.like++;
    if (data === "dislike") s.dislike++;
    await kv.put(likesKey, JSON.stringify(s));
    await kv.put(votesKey, data);
  }
  const s2 = await getLikes(chatId);
  await sendMessage(chatId, `Оцінки: 👍 ${s2.like} | 👎 ${s2.dislike}`);
  return true;
}

async function getLikes(chatId: number): Promise<Likes> {
  const kv = KVns();
  const raw = await kv.get(`likes:${chatId}`);
  if (!raw) return empty();
  try {
    const s = JSON.parse(raw) as Likes;
    return { like: Math.max(0, s.like|0), dislike: Math.max(0, s.dislike|0) };
  } catch {
    return empty();
  }
}