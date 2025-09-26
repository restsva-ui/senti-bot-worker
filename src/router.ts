import { CFG } from "./config";
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
} from "./telegram/api";

// ===================== KV & Likes =====================

type Counts = { like: number; dislike: number };

const COUNTS_KEY = "likes:counts";
const USER_KEY = (id: number) => `likes:user:${id}`;

async function getCounts(): Promise<Counts> {
  try {
    const raw = await CFG.kv.get(COUNTS_KEY);
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
  await CFG.kv.put(COUNTS_KEY, JSON.stringify(c));
}

/** Один голос від користувача з можливістю перемикати 👍↔️👎 */
async function registerVote(
  userId: number,
  choice: "like" | "dislike"
): Promise<Counts> {
  const prev = await CFG.kv.get(USER_KEY(userId));
  const counts = await getCounts();

  if (prev === choice) return counts;

  // зняти попередній голос
  if (prev === "like") counts.like = Math.max(0, counts.like - 1);
  if (prev === "dislike") counts.dislike = Math.max(0, counts.dislike - 1);

  // додати новий
  if (choice === "like") counts.like += 1;
  else counts.dislike += 1;

  await CFG.kv.put(USER_KEY(userId), choice);
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

async function cmdHelp(chatId: number) {
  const text =
    "🧾 Доступні команди:\n" +
    "/start — запуск і привітання\n" +
    "/ping — перевірка живості бота\n" +
    "/menu — головне меню\n" +
    "/likepanel — панель лайків\n" +
    "/kvtest — діагностика KV\n" +
    "/resetlikes — скинути лічильники\n" +
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
  const counts = await getCounts();
  await sendMessage(chatId, likesCaption(counts), {
    reply_markup: likesKeyboard(),
  });
}

// ======= Debug/maintenance =======

export async function cmdKvTest(chatId: number) {
  try {
    // спроба дістати і записати тестове значення
    const ok = !!CFG.kv;
    let detail = ok ? "OK" : "❌";
    const counts = await getCounts();
    await sendMessage(
      chatId,
      [
        "KV статус",
        `LIKES_KV: ${detail}`,
        "",
        "Лічильники",
        `👍 like: ${counts.like}`,
        `👎 dislike: ${counts.dislike}`,
      ].join("\n")
    );
  } catch (e) {
    await sendMessage(chatId, "❌ KV помилка: " + (e as Error).message);
  }
}

export async function cmdResetLikes(chatId: number) {
  if (!CFG.kv) {
    await sendMessage(chatId, "❌ KV не прив'язаний");
    return;
  }
  // видалити всі ключі likes:user:* (підчистимо лише відомих 1000 — більш ніж досить)
  let deleted = 0;
  const list = CFG.kv.list({ prefix: "likes:user:" });
  for await (const { name } of list) {
    await CFG.kv.delete(name);
    deleted++;
  }
  await CFG.kv.put(COUNTS_KEY, JSON.stringify({ like: 0, dislike: 0 }));
  await sendMessage(
    chatId,
    `✅ Скинуто лічильники (👍0 | 👎0) та видалено голосів: ${deleted}`
  );
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
      "/kvtest — діагностика KV\n" +
      "/resetlikes — скинути лічильники\n" +
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
  const choice = data === "vote:like" ? "like" : "dislike";
  const counts = await registerVote(fromId, choice);
  (globalThis as any).__cb_id = undefined; // не потрібно тут відповідати алертом
  await editMessageText(chatId, messageId, likesCaption(counts), {
    reply_markup: likesKeyboard(),
  });
}

// ===================== Entry point =====================

export async function handleUpdate(update: any) {
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
      if (text.startsWith("/resetlikes")) return cmdResetLikes(chatId);

      return cmdHelp(chatId);
    }

    // callback_query
    if (update.callback_query) {
      const cb = update.callback_query;
      const fromId: number = cb.from?.id;
      const data: string = cb.data || "";
      const chatId: number | undefined = cb.message?.chat?.id;
      const messageId: number | undefined = cb.message?.message_id;

      // збережемо id для answerCallbackQuery (якщо десь викличемо)
      (globalThis as any).__cb_id = cb.id;

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
        await answerCallbackQuery("✅ Зараховано");
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