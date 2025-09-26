// src/router.ts

import { getEnv } from "./config";
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
} from "./telegram/api";

// ===================== KV & Likes =====================

type Counts = { like: number; dislike: number };

const COUNTS_KEY = "likes:counts";
const USER_KEY = (id: number) => `likes:user:${id}`;
const USER_PREFIX = "likes:user:";

function getKv(): KVNamespace | undefined {
  const env = getEnv();
  // Binding з wrangler.toml: LIKES_KV
  return env.LIKES_KV as unknown as KVNamespace | undefined;
}

async function getCounts(): Promise<Counts> {
  const kv = getKv();
  if (!kv) return { like: 0, dislike: 0 };
  try {
    const raw = await kv.get(COUNTS_KEY);
    if (!raw) return { like: 0, dislike: 0 };
    const parsed = JSON.parse(raw) as Partial<Counts>;
    return {
      like: Number(parsed.like ?? 0),
      dislike: Number(parsed.dislike ?? 0),
    };
  } catch {
    return { like: 0, dislike: 0 };
  }
}

async function setCounts(c: Counts) {
  const kv = getKv();
  if (!kv) return;
  await kv.put(COUNTS_KEY, JSON.stringify(c));
}

/** Один голос від користувача з можливістю перемикати 👍↔️👎 */
async function registerVote(
  userId: number,
  choice: "like" | "dislike"
): Promise<Counts> {
  const kv = getKv();
  if (!kv) return { like: 0, dislike: 0 };

  const prev = await kv.get(USER_KEY(userId));
  const counts = await getCounts();

  if (prev === choice) return counts;

  // зняти попередній голос
  if (prev === "like") counts.like = Math.max(0, counts.like - 1);
  if (prev === "dislike") counts.dislike = Math.max(0, counts.dislike - 1);

  // додати новий
  if (choice === "like") counts.like += 1;
  else counts.dislike += 1;

  await kv.put(USER_KEY(userId), choice);
  await setCounts(counts);
  return counts;
}

/** Підрахунок кількості user-ключів (для діагностики) */
async function countUserVotes(): Promise<{ totalUsers: number; sample: string[] }> {
  const kv = getKv();
  if (!kv) return { totalUsers: 0, sample: [] };

  let cursor: string | undefined = undefined;
  let total = 0;
  const sample: string[] = [];

  do {
    const { keys, cursor: next } = await kv.list({ prefix: USER_PREFIX, cursor });
    total += keys.length;
    // зберемо кілька прикладів (до 5)
    for (const k of keys) {
      if (sample.length < 5) sample.push(k.name);
      else break;
    }
    cursor = next;
  } while (cursor);

  return { totalUsers: total, sample };
}

// ===================== UI helpers =====================

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🔁 Ping", callback_data: "menu:ping" }],
      [{ text: "👍 Лайки", callback_data: "menu:likepanel" }],
      [{ text: "ℹ️ Допомога", callback_data: "menu:help" }],
    ],
  };
}

function likesKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "👍", callback_data: "vote:like" },
        { text: "👎", callback_data: "vote:dislike" },
      ],
    ],
  };
}

function likesCaption(c: Counts) {
  return `Оцінки: 👍 ${c.like} | 👎 ${c.dislike}`;
}

// ===================== Commands =====================

async function cmdStart(chatId: number) {
  await sendMessage(
    chatId,
    "👋 Привіт! Бот підключено до Cloudflare Workers. Напишіть /help для довідки."
  );
}

async function cmdHelp(chatId: number) {
  const text =
    "🧾 Доступні команди:\n" +
    "/start — запуск і привітання\n" +
    "/ping — перевірка живості бота\n" +
    "/menu — головне меню\n" +
    "/likepanel — панель лайків\n" +
    "/kvtest — перевірити KV-статус і ключі\n" +
    "/help — довідка";
  await sendMessage(chatId, text);
}

async function cmdPing(chatId: number) {
  await sendMessage(chatId, "pong ✅");
}

async function cmdMenu(chatId: number) {
  await sendMessage(chatId, "Головне меню:", {
    reply_markup: mainMenuKeyboard(),
  });
}

async function cmdLikePanel(chatId: number) {
  const kv = getKv();
  if (!kv) {
    await sendMessage(chatId, "⚠️ KV не прив'язаний. Звернись до /help.");
    return;
  }
  const counts = await getCounts();
  await sendMessage(chatId, likesCaption(counts), {
    reply_markup: likesKeyboard(),
  });
}

/** Діагностика KV: показує загальний стан і кілька ключів */
async function cmdKvTest(chatId: number) {
  const kv = getKv();
  if (!kv) {
    await sendMessage(chatId, "❌ KV (LIKES_KV) не прив'язано у воркері.");
    return;
  }

  const counts = await getCounts();
  const { totalUsers, sample } = await countUserVotes();

  const lines = [
    "<b>KV статус</b>",
    `LIKES_KV: <code>OK</code>`,
    "",
    "<b>Лічильники</b>",
    `👍 like: <b>${counts.like}</b>`,
    `👎 dislike: <b>${counts.dislike}</b>`,
    "",
    "<b>Користувачі з голосом</b>",
    `всього ключів: <b>${totalUsers}</b>`,
    ...(sample.length ? ["приклади:", ...sample.map((s) => `<code>${s}</code>`)] : []),
  ].join("\n");

  await sendMessage(chatId, lines, { parse_mode: "HTML" });
}

// ===================== Callback handlers =====================

async function cbMenu(chatId: number, messageId: number, data: string) {
  if (data === "menu:ping") {
    await editMessageText(chatId, messageId, "pong ✅", {
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }
  if (data === "menu:likepanel") {
    const counts = await getCounts();
    await editMessageText(chatId, messageId, likesCaption(counts), {
      reply_markup: likesKeyboard(),
    });
    return;
  }
  if (data === "menu:help") {
    const text =
      "🧾 Доступні команди:\n" +
      "/start — запуск і привітання\n" +
      "/ping — перевірка живості бота\n" +
      "/menu — головне меню\n" +
      "/likepanel — панель лайків\n" +
      "/kvtest — перевірити KV-статус і ключі\n" +
      "/help — довідка";
    await editMessageText(chatId, messageId, text, {
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }
  await editMessageText(chatId, messageId, "🤷‍♂️ Невідома дія кнопки.", {
    reply_markup: mainMenuKeyboard(),
  });
}

async function cbVote(
  fromId: number,
  chatId: number,
  messageId: number,
  data: "vote:like" | "vote:dislike"
) {
  const kv = getKv();
  if (!kv) {
    await answerCallbackQuery("⚠️ KV не прив'язаний");
    return;
  }
  const choice = data === "vote:like" ? "like" : "dislike";
  const counts = await registerVote(fromId, choice);
  await answerCallbackQuery("✅ Зараховано");
  await editMessageText(chatId, messageId, likesCaption(counts), {
    reply_markup: likesKeyboard(),
  });
}

// ===================== Entry point =====================

export async function handleUpdate(update: any, _ctx?: ExecutionContext) {
  try {
    // повідомлення / команди
    if (update.message) {
      const msg = update.message;
      const chatId: number = msg.chat?.id;
      const text: string = (msg.text || "").trim();

      if (text.startsWith("/start")) return cmdStart(chatId);
      if (text.startsWith("/help")) return cmdHelp(chatId);
      if (text.startsWith("/ping")) return cmdPing(chatId);
      if (text.startsWith("/menu")) return cmdMenu(chatId);
      if (text.startsWith("/likepanel")) return cmdLikePanel(chatId);
      if (text.startsWith("/kvtest")) return cmdKvTest(chatId);

      return cmdHelp(chatId);
    }

    // callback_query
    if (update.callback_query) {
      const cb = update.callback_query;
      const fromId: number = cb.from?.id;
      const data: string = cb.data || "";
      const chatId: number | undefined = cb.message?.chat?.id;
      const messageId: number | undefined = cb.message?.message_id;

      if (!chatId || !messageId) {
        // безпечний no-op (див. реалізацію answerCallbackQuery у telegram/api.ts)
        await answerCallbackQuery();
        return;
      }

      if (data.startsWith("menu:")) {
        await answerCallbackQuery();
        await cbMenu(chatId, messageId, data);
        return;
      }

      if (data === "vote:like" || data === "vote:dislike") {
        await cbVote(fromId, chatId, messageId, data);
        return;
      }

      await answerCallbackQuery("🤷‍♂️ Невідома дія");
      return;
    }
  } catch (err) {
    console.error("handleUpdate fatal:", (err as Error).message || err);
  }
}