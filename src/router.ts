// src/router.ts

import { getEnv, type Env } from "./config";
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
} from "./telegram/api";

// owner tools
import {
  cmdKvList,       // /kvtest
  cmdResetLikes,   // /resetlikes
  cmdStats,        // /stats
  cmdExport,       // /export
} from "./commands/kvdebug";

// ===================== KV & Likes =====================

type Counts = { like: number; dislike: number };

const COUNTS_KEY = "likes:counts";
const USER_KEY = (id: number) => `likes:user:${id}`;

function kv(): KVNamespace | undefined {
  const env = getEnv();
  // У конфі: binding = "LIKES_KV"; в getEnv() віддано як env.KV
  return (env as unknown as { KV?: KVNamespace }).KV;
}

async function getCounts(): Promise<Counts> {
  try {
    const store = kv();
    if (!store) return { like: 0, dislike: 0 };
    const raw = await store.get(COUNTS_KEY);
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
  const store = kv();
  if (!store) return;
  await store.put(COUNTS_KEY, JSON.stringify(c));
}

/** Один голос від користувача з можливістю перемикати 👍↔️👎 */
async function registerVote(
  userId: number,
  choice: "like" | "dislike"
): Promise<Counts> {
  const store = kv();
  // Якщо KV не підв’язаний — просто повернути поточні лічильники (нульові)
  if (!store) return getCounts();

  const prev = await store.get(USER_KEY(userId));
  const counts = await getCounts();

  if (prev === choice) return counts;

  // зняти попередній голос
  if (prev === "like") counts.like = Math.max(0, counts.like - 1);
  if (prev === "dislike") counts.dislike = Math.max(0, counts.dislike - 1);

  // додати новий
  if (choice === "like") counts.like += 1;
  else counts.dislike += 1;

  await store.put(USER_KEY(userId), choice);
  await setCounts(counts);
  return counts;
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
  return "Оцінки: 👍 " + c.like + " | 👎 " + c.dislike;
}

// ===================== Commands =====================

async function cmdStart(chatId: number) {
  await sendMessage(
    chatId,
    "👋 Привіт! Бот підключено до Cloudflare Workers. Напишіть /help для довідки."
  );
}

async function cmdHelp(chatId: number, isOwner: boolean) {
  const base =
    "🧾 Доступні команди:\n" +
    "/start — запуск і привітання\n" +
    "/ping — перевірка живості бота\n" +
    "/menu — головне меню\n" +
    "/likepanel — панель лайків\n" +
    "/help — довідка";
  const owner =
    "\n\n👑 Owner utils:\n" +
    "/kvtest — перевірка KV\n" +
    "/resetlikes — скинути лічильники й голоси\n" +
    "/stats — коротка статистика KV\n" +
    "/export — експорт даних KV";
  await sendMessage(chatId, base + (isOwner ? owner : ""));
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
  const counts = await getCounts();
  await sendMessage(chatId, likesCaption(counts), {
    reply_markup: likesKeyboard(),
  });
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
    const env = getEnv();
    const isOwnerText =
      "\n\n(Підказка: якщо ти власник, є ще /kvtest /resetlikes /stats /export)";
    await editMessageText(
      chatId,
      messageId,
      "🧾 Доступні команди:\n" +
        "/start — запуск і привітання\n" +
        "/ping — перевірка живості бота\n" +
        "/menu — головне меню\n" +
        "/likepanel — панель лайків\n" +
        "/help — довідка" +
        isOwnerText,
      { reply_markup: mainMenuKeyboard() }
    );
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
  const choice = data === "vote:like" ? "like" : "dislike";
  const counts = await registerVote(fromId, choice);
  await answerCallbackQuery("✅ Зараховано");
  await editMessageText(chatId, messageId, likesCaption(counts), {
    reply_markup: likesKeyboard(),
  });
}

// ===================== Entry point =====================

export async function handleUpdate(update: any) {
  try {
    const env = getEnv();
    const ownerIdStr = String(env.OWNER_ID || "");
    const fromId: number | undefined =
      update?.message?.from?.id ?? update?.callback_query?.from?.id;
    const isOwner = !!fromId && String(fromId) === ownerIdStr;

    // повідомлення / команди
    if (update.message) {
      const msg = update.message;
      const chatId: number = msg.chat?.id;
      const text: string = (msg.text || "").trim();

      if (text.startsWith("/start")) return cmdStart(chatId);
      if (text.startsWith("/help")) return cmdHelp(chatId, isOwner);
      if (text.startsWith("/ping")) return cmdPing(chatId);
      if (text.startsWith("/menu")) return cmdMenu(chatId);
      if (text.startsWith("/likepanel")) return cmdLikePanel(chatId);

      // ===== owner-only debug commands =====
      if (isOwner && text.startsWith("/kvtest")) return cmdKvList(chatId);
      if (isOwner && text.startsWith("/resetlikes")) return cmdResetLikes(chatId);
      if (isOwner && text.startsWith("/stats")) return cmdStats(chatId);
      if (isOwner && text.startsWith("/export")) return cmdExport(chatId);

      return cmdHelp(chatId, isOwner);
    }

    // callback_query
    if (update.callback_query) {
      const cb = update.callback_query;
      const data: string = cb.data || "";
      const chatId: number | undefined = cb.message?.chat?.id;
      const messageId: number | undefined = cb.message?.message_id;

      if (!chatId || !messageId) {
        await answerCallbackQuery();
        return;
      }

      if (data.startsWith("menu:")) {
        await answerCallbackQuery();
        await cbMenu(chatId, messageId, data);
        return;
      }

      if (data === "vote:like" || data === "vote:dislike") {
        const voterId: number = cb.from?.id;
        await cbVote(voterId, chatId, messageId, data);
        return;
      }

      await answerCallbackQuery("🤷‍♂️ Невідома дія");
      return;
    }
  } catch (err) {
    console.error("handleUpdate fatal:", (err as Error).message || err);
  }
}