// src/router.ts
import { CFG, getEnv } from "./config";
import { sendMessage, editMessageText, answerCallback } from "./telegram/api";

// простий тип апдейту (достатньо для цих команд)
type TgUpdate = {
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    from?: { id: number; username?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: {
      message_id: number;
      chat: { id: number };
    };
    from: { id: number; username?: string };
  };
};

function likeKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "👍", callback_data: "like" }, { text: "👎", callback_data: "dislike" }],
    ],
  };
}

async function readCounters() {
  const kv = CFG.kv();
  if (!kv) return { likes: 0, dislikes: 0 };
  const [l, d] = await Promise.all([
    kv.get("likes_total"),
    kv.get("dislikes_total"),
  ]);
  return {
    likes: Number(l ?? 0),
    dislikes: Number(d ?? 0),
  };
}

async function writeCounters(likes: number, dislikes: number) {
  const kv = CFG.kv();
  if (!kv) return;
  await kv.put("likes_total", String(likes));
  await kv.put("dislikes_total", String(dislikes));
}

async function getUserVote(userId: number): Promise<"like" | "dislike" | null> {
  const kv = CFG.kv();
  if (!kv) return null;
  return (await kv.get(`vote_${userId}`)) as any;
}

async function setUserVote(userId: number, v: "like" | "dislike" | null) {
  const kv = CFG.kv();
  if (!kv) return;
  const key = `vote_${userId}`;
  if (v) await kv.put(key, v);
  else await kv.delete(key);
}

async function statsLine() {
  const { likes, dislikes } = await readCounters();
  return `Оцінки: 👍 ${likes} | 👎 ${dislikes}`;
}

async function handleStart(chatId: number) {
  await sendMessage(chatId, "👋 Привіт! Бот підключено до Cloudflare Workers. Напишіть /help для довідки.");
}

async function handlePing(chatId: number) {
  await sendMessage(chatId, "pong ✅");
}

async function handleHelp(chatId: number) {
  await sendMessage(
    chatId,
    [
      "📑 Доступні команди:",
      "/start — запуск і привітання",
      "/ping — перевірка живості бота",
      "/menu — головне меню",
      "/likepanel — панель лайків",
      "/help — довідка",
    ].join("\n"),
  );
}

async function handleMenu(chatId: number) {
  await sendMessage(chatId, "Головне меню:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔁 Ping", callback_data: "menu_ping" }],
        [{ text: "👍 Лайки", callback_data: "menu_likepanel" }],
        [{ text: "ℹ️ Допомога", callback_data: "menu_help" }],
      ],
    },
  });
}

async function handleLikePanel(chatId: number) {
  const line = await statsLine();
  await sendMessage(chatId, line, { reply_markup: likeKeyboard() });
}

async function handleMenuCallback(data: string, q: TgUpdate["callback_query"]) {
  if (!q?.message) return;
  const chatId = q.message.chat.id;
  switch (data) {
    case "menu_ping":
      await answerCallback(q.id);
      await handlePing(chatId);
      break;
    case "menu_likepanel":
      await answerCallback(q.id);
      await handleLikePanel(chatId);
      break;
    case "menu_help":
      await answerCallback(q.id);
      await handleHelp(chatId);
      break;
  }
}

async function handleVote(action: "like" | "dislike", q: TgUpdate["callback_query"]) {
  if (!q?.message) return;
  const chatId = q.message.chat.id;
  const msgId = q.message.message_id;
  const userId = q.from.id;

  let { likes, dislikes } = await readCounters();
  const prev = await getUserVote(userId);

  // політика: від 1 користувача лише 1 голос.
  if (prev === action) {
    await answerCallback(q.id, "Ви вже проголосували так само 🙂");
    return;
  }

  // якщо міняє сторони — віднімаємо попередній голос
  if (prev === "like") likes = Math.max(0, likes - 1);
  if (prev === "dislike") dislikes = Math.max(0, dislikes - 1);

  // ставимо новий голос
  if (action === "like") likes += 1;
  else dislikes += 1;

  await setUserVote(userId, action);
  await writeCounters(likes, dislikes);

  const text = `Оцінки: 👍 ${likes} | 👎 ${dislikes}`;
  await editMessageText(chatId, msgId, text, { reply_markup: likeKeyboard() });
  await answerCallback(q.id, "Дякую за оцінку!");
}

export async function handleUpdate(update: TgUpdate) {
  // гарантуємо, що env ініціалізований
  getEnv();

  if (update.message?.text) {
    const chatId = update.message.chat.id;
    const text = update.message.text.trim();

    if (text.startsWith("/start")) return handleStart(chatId);
    if (text.startsWith("/ping")) return handlePing(chatId);
    if (text.startsWith("/help")) return handleHelp(chatId);
    if (text.startsWith("/menu")) return handleMenu(chatId);
    if (text.startsWith("/likepanel")) return handleLikePanel(chatId);

    // службова: перевірка KV-стану
    if (text.startsWith("/kv_state")) {
      const kv = CFG.kv();
      await sendMessage(chatId, `KV STATE: ${kv ? "✅" : "❌"}`);
      return;
    }

    // службова: список ключів
    if (text.startsWith("/kv_list")) {
      const kv = CFG.kv();
      if (!kv) return sendMessage(chatId, "❌ KV не прив'язаний");
      const list = await kv.list({ limit: 20 });
      const out = list.keys.length
        ? "🔑 Ключі:\n" + list.keys.map(k => `• ${k.name}`).join("\n")
        : "📭 KV порожній";
      return sendMessage(chatId, out);
    }
  }

  if (update.callback_query) {
    const data = update.callback_query.data || "";
    if (data.startsWith("menu_")) return handleMenuCallback(data, update.callback_query);
    if (data === "like" || data === "dislike")
      return handleVote(data, update.callback_query);
  }
}