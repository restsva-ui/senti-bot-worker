import { CFG } from "./config";
import { sendMessage, editMessageText, answerCallbackQuery } from "./telegram/api";

type Counts = { like: number; dislike: number };

const COUNTS_KEY = "likes:counts";
const USER_KEY = (id: number) => `likes:user:${id}`;

async function getCounts(): Promise<Counts> {
  try {
    const raw = await CFG.kv.get(COUNTS_KEY);
    if (!raw) return { like: 0, dislike: 0 };
    const p = JSON.parse(raw) as Partial<Counts>;
    return { like: Number(p.like ?? 0), dislike: Number(p.dislike ?? 0) };
  } catch {
    return { like: 0, dislike: 0 };
  }
}

async function setCounts(c: Counts) {
  await CFG.kv.put(COUNTS_KEY, JSON.stringify(c));
}

async function registerVote(userId: number, choice: "like" | "dislike"): Promise<Counts> {
  const prev = await CFG.kv.get(USER_KEY(userId));
  const counts = await getCounts();

  if (prev === choice) return counts;

  if (prev === "like") counts.like = Math.max(0, counts.like - 1);
  if (prev === "dislike") counts.dislike = Math.max(0, counts.dislike - 1);

  if (choice === "like") counts.like += 1;
  else counts.dislike += 1;

  await CFG.kv.put(USER_KEY(userId), choice);
  await setCounts(counts);
  return counts;
}

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
    inline_keyboard: [[{ text: "👍", callback_data: "vote:like" }, { text: "👎", callback_data: "vote:dislike" }]],
  };
}

function likesCaption(c: Counts) {
  return `Оцінки: 👍 ${c.like} | 👎 ${c.dislike}`;
}

async function cmdStart(chatId: number) {
  await sendMessage(chatId, "👋 Привіт! Бот підключено до Cloudflare Workers. Напишіть /help для довідки.");
}
async function cmdHelp(chatId: number) {
  const text =
    "🧾 Доступні команди:\n" +
    "/start — запуск і привітання\n" +
    "/ping — перевірка живості бота\n" +
    "/menu — головне меню\n" +
    "/likepanel — панель лайків\n" +
    "/help — довідка";
  await sendMessage(chatId, text);
}
async function cmdPing(chatId: number) {
  await sendMessage(chatId, "pong ✅");
}
async function cmdMenu(chatId: number) {
  await sendMessage(chatId, "Головне меню:", { reply_markup: mainMenuKeyboard() });
}
async function cmdLikePanel(chatId: number) {
  const counts = await getCounts();
  await sendMessage(chatId, likesCaption(counts), { reply_markup: likesKeyboard() });
}

async function cbMenu(cbId: string, chatId: number, messageId: number, data: string) {
  if (data === "menu:ping") {
    await answerCallbackQuery(cbId);
    await editMessageText(chatId, messageId, "pong ✅", { reply_markup: mainMenuKeyboard() });
    return;
  }
  if (data === "menu:likepanel") {
    await answerCallbackQuery(cbId);
    const counts = await getCounts();
    await editMessageText(chatId, messageId, likesCaption(counts), { reply_markup: likesKeyboard() });
    return;
  }
  if (data === "menu:help") {
    await answerCallbackQuery(cbId);
    const text =
      "🧾 Доступні команди:\n" +
      "/start — запуск і привітання\n" +
      "/ping — перевірка живості бота\n" +
      "/menu — головне меню\n" +
      "/likepanel — панель лайків\n" +
      "/help — довідка";
    await editMessageText(chatId, messageId, text, { reply_markup: mainMenuKeyboard() });
    return;
  }
  await answerCallbackQuery(cbId, "🤷‍♂️ Невідома дія");
  await editMessageText(chatId, messageId, "🤷‍♂️ Невідома дія кнопки.", { reply_markup: mainMenuKeyboard() });
}

async function cbVote(
  cbId: string,
  fromId: number,
  chatId: number,
  messageId: number,
  data: "vote:like" | "vote:dislike"
) {
  const choice = data === "vote:like" ? "like" : "dislike";
  const counts = await registerVote(fromId, choice);
  await answerCallbackQuery(cbId, "✅ Зараховано");
  await editMessageText(chatId, messageId, likesCaption(counts), { reply_markup: likesKeyboard() });
}

export async function handleUpdate(update: any) {
  try {
    if (update.message) {
      const msg = update.message;
      const chatId: number = msg.chat?.id;
      const text: string = (msg.text || "").trim();

      if (text.startsWith("/start")) return cmdStart(chatId);
      if (text.startsWith("/help")) return cmdHelp(chatId);
      if (text.startsWith("/ping")) return cmdPing(chatId);
      if (text.startsWith("/menu")) return cmdMenu(chatId);
      if (text.startsWith("/likepanel")) return cmdLikePanel(chatId);

      return cmdHelp(chatId);
    }

    if (update.callback_query) {
      const cb = update.callback_query;
      const cbId: string = cb.id;
      const fromId: number = cb.from?.id;
      const data: string = cb.data || "";
      const chatId: number | undefined = cb.message?.chat?.id;
      const messageId: number | undefined = cb.message?.message_id;

      if (!chatId || !messageId) {
        await answerCallbackQuery(cbId);
        return;
      }

      if (data.startsWith("menu:")) return cbMenu(cbId, chatId, messageId, data);
      if (data === "vote:like" || data === "vote:dislike") return cbVote(cbId, fromId, chatId, messageId, data);

      await answerCallbackQuery(cbId, "🤷‍♂️ Невідома дія");
    }
  } catch (err) {
    console.error("handleUpdate fatal:", (err as Error).message || err);
  }
}