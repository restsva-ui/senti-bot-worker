// src/commands/likepanel.ts
import { CFG } from "../config";
import { sendMessage, editMessageText, answerCallbackQuery } from "../telegram/api";

// Мінімально потрібні типи з Telegram
type TGUser = { id: number };
type TGChat = { id: number };
type TGMessage = { message_id: number; chat: TGChat };
type TGCallbackQuery = { id: string; from: TGUser; data?: string; message?: TGMessage };
type TGUpdate = { callback_query?: TGCallbackQuery };

type StateUnique = { up: number; down: number; voters: Record<string, "up" | "down"> };
type StateCumulative = { up: number; down: number };

const PREFIX = "likes";

function kvKey(chatId: number, messageId: number) {
  return `${PREFIX}:${chatId}:${messageId}`;
}

function likeText(up: number, down: number) {
  return `Оцінки: 👍 ${up} | 👎 ${down}`;
}

function keyboard() {
  return {
    inline_keyboard: [
      [{ text: "👍", callback_data: "like:up" }, { text: "👎", callback_data: "like:down" }],
    ],
  };
}

async function getUniqueState(chatId: number, messageId: number): Promise<StateUnique> {
  const raw = await CFG.KV.get(kvKey(chatId, messageId));
  if (!raw) return { up: 0, down: 0, voters: {} };
  try {
    const parsed = JSON.parse(raw) as StateUnique;
    // Backward-compat guard
    return { up: parsed.up || 0, down: parsed.down || 0, voters: parsed.voters || {} };
  } catch {
    return { up: 0, down: 0, voters: {} };
  }
}

async function getCumulativeState(chatId: number, messageId: number): Promise<StateCumulative> {
  const raw = await CFG.KV.get(kvKey(chatId, messageId));
  if (!raw) return { up: 0, down: 0 };
  try {
    const parsed = JSON.parse(raw) as StateCumulative;
    return { up: parsed.up || 0, down: parsed.down || 0 };
  } catch {
    return { up: 0, down: 0 };
  }
}

async function putState(chatId: number, messageId: number, obj: unknown) {
  await CFG.KV.put(kvKey(chatId, messageId), JSON.stringify(obj));
}

/** Виводить панель лайків з нулями (рахунок підтягнеться при першому кліку) */
export async function likepanel(chatId: number) {
  await sendMessage(chatId, likeText(0, 0), { reply_markup: keyboard() });
}

/** Обробка callback’ів від кнопок 👍 / 👎. Повертає true, якщо оброблено. */
export async function handleLikeCallback(update: TGUpdate): Promise<boolean> {
  const cq = update.callback_query;
  if (!cq || !cq.data || !cq.message) return false;

  const data = cq.data;
  if (data !== "like:up" && data !== "like:down") return false;

  const chatId = cq.message.chat.id;
  const messageId = cq.message.message_id;
  const direction = data === "like:up" ? "up" : "down";

  // Підтвердження та прибирання «годинника»
  await answerCallbackQuery(cq.id).catch(() => {});

  const mode = (CFG.LIKE_MODE || "unique").toLowerCase(); // "unique" | "cumulative"

  if (mode === "cumulative") {
    // Кожен клік — +1 (навіть від того самого користувача)
    const st = await getCumulativeState(chatId, messageId);
    if (direction === "up") st.up += 1;
    else st.down += 1;

    await putState(chatId, messageId, st);
    await editMessageText(chatId, messageId, likeText(st.up, st.down), { reply_markup: keyboard() });
    return true;
  }

  // UNIQUE: один голос на користувача, можна переключати між up/down
  const st = await getUniqueState(chatId, messageId);
  const uid = String(cq.from.id);
  const prev = st.voters[uid];

  if (!prev) {
    // Перший голос
    if (direction === "up") st.up += 1;
    else st.down += 1;
    st.voters[uid] = direction;
  } else if (prev !== direction) {
    // Перемикання голосу
    if (prev === "up") st.up = Math.max(0, st.up - 1);
    else st.down = Math.max(0, st.down - 1);

    if (direction === "up") st.up += 1;
    else st.down += 1;

    st.voters[uid] = direction;
  } // якщо клік у той самий бік — нічого не змінюємо

  await putState(chatId, messageId, st);
  await editMessageText(chatId, messageId, likeText(st.up, st.down), { reply_markup: keyboard() });
  return true;
}