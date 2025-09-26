import { KVns } from "../config";
import { sendMessage, editMessageText } from "../telegram/api";

// 1 користувач = 1 активний голос у чаті (можна перемикати)
type Likes = { like: number; dislike: number };
const empty = (): Likes => ({ like: 0, dislike: 0 });

const PANEL_MARKUP = {
  inline_keyboard: [
    [{ text: "👍", callback_data: "like" }, { text: "👎", callback_data: "dislike" }],
  ],
};

export async function likepanel(chatId: number) {
  const s = await getLikes(chatId);
  await sendMessage(chatId, render(s), PANEL_MARKUP);
}

export async function handleLikeCallback(update: any): Promise<boolean> {
  const cq = update.callback_query;
  if (!cq?.data || !cq.message?.chat?.id || !cq.from?.id) return false;

  const chatId = cq.message.chat.id as number;
  const msgId = cq.message.message_id as number;
  const userId = cq.from.id as number;
  const data = String(cq.data); // "like" | "dislike"
  if (data !== "like" && data !== "dislike") return false;

  const kv = KVns();
  const votesKey = `votes:${chatId}:${userId}`;
  const likesKey = `likes:${chatId}`;

  // оновлюємо лічильники: знімаємо попередній голос, ставимо новий
  const prev = await kv.get(votesKey); // "like" | "dislike" | null
  if (prev !== data) {
    const s = await getLikes(chatId);
    if (prev === "like") s.like = Math.max(0, s.like - 1);
    if (prev === "dislike") s.dislike = Math.max(0, s.dislike - 1);
    if (data === "like") s.like++;
    if (data === "dislike") s.dislike++;
    await kv.put(likesKey, JSON.stringify(s));
    await kv.put(votesKey, data);
  }

  // повторно читаємо (щоб точно відобразити актуальний стан)
  const s2 = await getLikes(chatId);

  // 🔧 ГОЛОВНЕ: редагуємо те саме повідомлення, а не шлемо нове
  await editMessageText(chatId, msgId, render(s2), PANEL_MARKUP)
    .catch(async () => {
      // якщо повідомлення вже не можна редагувати — просто шлемо нове
      await sendMessage(chatId, render(s2), PANEL_MARKUP);
    });

  return true;
}

function render(s: Likes) {
  return `Оцінки: 👍 ${s.like} | 👎 ${s.dislike}`;
}

async function getLikes(chatId: number): Promise<Likes> {
  const kv = KVns();
  const raw = await kv.get(`likes:${chatId}`);
  if (!raw) return empty();
  try {
    const s = JSON.parse(raw) as Likes;
    return { like: Math.max(0, s.like | 0), dislike: Math.max(0, s.dislike | 0) };
  } catch {
    return empty();
  }
}