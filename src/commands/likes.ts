// src/commands/likes.ts
import type { TgUpdate } from "../types";

/**
 * Команда /likes — надсилає повідомлення з кнопкою "❤️ <count>".
 * Лічильник зберігаємо у KV за ключем: likes:<chatId>:<messageId>
 * Антиспам: 1 клік / користувач / 5с через ключ:
 * likes_users:<chatId>:<messageId>:<userId>
 */
const CB_PREFIX = "likes:";
const CB_INC = `${CB_PREFIX}inc`;

// Антиспам: TTL (секунди). Мінімум 1, максимум 1 хв. (клемп)
const SPAM_TTL_SEC = 5;

export const likesCommand = {
  name: "likes",
  description: "Показує кнопку ❤️ та рахує натискання",
  async execute(
    env: { BOT_TOKEN: string; API_BASE_URL?: string; LIKES_KV: KVNamespace },
    update: TgUpdate
  ) {
    const msg = update.message;
    const chatId = msg?.chat?.id;
    if (!chatId) return;

    // Спочатку надсилаємо повідомлення з кнопкою "❤️ 0".
    const keyboard = {
      inline_keyboard: [[{ text: "❤️ 0", callback_data: CB_INC }]],
    };

    const sent = await sendMessage(env, chatId, "Лайкни це повідомлення:", {
      reply_markup: keyboard,
    });

    // Ініціалізуємо лічильник у KV (на випадок першого кліку)
    const messageId = sent?.result?.message_id as number | undefined;
    if (typeof messageId === "number") {
      const key = kvLikesKey(chatId, messageId);
      const existed = await env.LIKES_KV.get(key);
      if (!existed) {
        await env.LIKES_KV.put(key, JSON.stringify({ count: 0 }));
      }
    }
  },
} as const;

/** Чи можемо ми обробити цей callback */
export function likesCanHandleCallback(data: string | undefined): boolean {
  return data === CB_INC;
}

/** Обробка callback: антиспам + інкремент у KV і оновлення кнопки */
export async function likesOnCallback(
  env: { BOT_TOKEN: string; API_BASE_URL?: string; LIKES_KV: KVNamespace },
  update: TgUpdate
): Promise<void> {
  const cq: any = (update as any).callback_query;
  const data: string | undefined = cq?.data;
  const chatId: number | undefined = cq?.message?.chat?.id;
  const messageId: number | undefined = cq?.message?.message_id;
  const cqId: string | undefined = cq?.id;
  const userId: number | undefined = cq?.from?.id;

  if (!data || !chatId || !messageId || !cqId || !userId) return;

  // ---- Антиспам ----
  const spamKey = kvSpamKey(chatId, messageId, userId);
  const ttl = clampTtl(SPAM_TTL_SEC, 1, 60);
  const recent = await env.LIKES_KV.get(spamKey);
  if (recent) {
    // Ліміт: один клік у вікні TTL
    await answerCallbackQuery(env, cqId, "Занадто часто 🙂 Спробуйте за кілька секунд");
    return;
  }
  // Ставимо маркер для користувача з TTL
  await env.LIKES_KV.put(spamKey, "1", { expirationTtl: ttl });
  // -------------------

  const key = kvLikesKey(chatId, messageId);

  // 1) Поточне значення
  let count = 0;
  try {
    const val = await env.LIKES_KV.get(key);
    if (val) {
      const parsed = JSON.parse(val);
      const num = Number(parsed?.count);
      if (Number.isFinite(num) && num >= 0) count = num;
    }
  } catch (e) {
    console.warn("likes: parse KV error", e);
  }

  // 2) Інкремент
  count += 1;
  await env.LIKES_KV.put(key, JSON.stringify({ count }));

  // 3) Оновлюємо підпис кнопки
  const keyboard = {
    inline_keyboard: [[{ text: `❤️ ${count}`, callback_data: CB_INC }]],
  };
  await editMessageReplyMarkup(env, chatId, messageId, keyboard);

  // 4) Відповідаємо на callback (без спливаючого тексту)
  await answerCallbackQuery(env, cqId);
}

/* ===================== helpers ===================== */

function kvLikesKey(chatId: number, messageId: number) {
  return `likes:${chatId}:${messageId}`;
}
function kvSpamKey(chatId: number, messageId: number, userId: number) {
  return `likes_users:${chatId}:${messageId}:${userId}`;
}
function clampTtl(ttl: number, min: number, max: number) {
  const t = Math.floor(ttl);
  return Math.max(min, Math.min(max, t));
}

async function sendMessage(
  env: { BOT_TOKEN: string; API_BASE_URL?: string },
  chatId: number,
  text: string,
  extra?: Record<string, unknown>
): Promise<any | null> {
  const apiBase = env.API_BASE_URL || "https://api.telegram.org";
  const url = `${apiBase}/bot${env.BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text, ...extra });

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  let json: any | null = null;
  try {
    json = await res.json();
  } catch (_) {
    // ignore
  }

  if (!res.ok) {
    console.error("sendMessage error:", res.status, json ?? (await res.text().catch(() => "")));
  }
  return json;
}

async function editMessageReplyMarkup(
  env: { BOT_TOKEN: string; API_BASE_URL?: string },
  chatId: number,
  messageId: number,
  replyMarkup: any
) {
  const apiBase = env.API_BASE_URL || "https://api.telegram.org";
  const url = `${apiBase}/bot${env.BOT_TOKEN}/editMessageReplyMarkup`;
  const body = JSON.stringify({
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("editMessageReplyMarkup error:", res.status, errText);
  }
}

async function answerCallbackQuery(
  env: { BOT_TOKEN: string; API_BASE_URL?: string },
  callbackQueryId: string,
  text?: string
) {
  const apiBase = env.API_BASE_URL || "https://api.telegram.org";
  const url = `${apiBase}/bot${env.BOT_TOKEN}/answerCallbackQuery`;
  const body = JSON.stringify(
    text ? { callback_query_id: callbackQueryId, text, show_alert: false } : { callback_query_id: callbackQueryId }
  );

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("answerCallbackQuery error:", res.status, errText);
  }
}