// src/commands/likes.ts
import type { TgUpdate } from "../types";

/**
 * /likes — кнопка "❤️ <count>" з лічильником у KV:
 *   likes:<chatId>:<messageId> -> { count: number }
 *
 * Антиспам: 1 клік / користувач / 5с.
 *   Зберігаємо timestamp у KV з TTL >= 60с:
 *   likes_users:<chatId>:<messageId>:<userId> -> { ts: number }
 *   Перевіряємо різницю часу локально.
 */
const CB_PREFIX = "likes:";
const CB_INC = `${CB_PREFIX}inc`;

// Вікно антиспаму
const SPAM_WINDOW_MS = 5_000;
// Безпечний TTL для KV (мінімум 60с, щоб не падало)
const SAFE_TTL_SEC = 60;

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

    const keyboard = { inline_keyboard: [[{ text: "❤️ 0", callback_data: CB_INC }]] };

    const sent = await sendMessage(env, chatId, "Лайкни це повідомлення:", {
      reply_markup: keyboard,
    });

    // Ініціалізація лічильника
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

export function likesCanHandleCallback(data: string | undefined): boolean {
  return data === CB_INC;
}

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

  try {
    // ---- Антиспам (через timestamp у KV, TTL >= 60s) ----
    const spamKey = kvSpamKey(chatId, messageId, userId);
    const now = Date.now();
    let tooSoon = false;

    const prevJson = await env.LIKES_KV.get(spamKey);
    if (prevJson) {
      try {
        const prev = JSON.parse(prevJson) as { ts?: number };
        if (typeof prev.ts === "number" && now - prev.ts < SPAM_WINDOW_MS) {
          tooSoon = true;
        }
      } catch { /* ignore parse */ }
    }

    if (tooSoon) {
      await answerCallbackQuery(env, cqId, "Занадто часто 🙂 Спробуйте за кілька секунд");
      return;
    }

    // Записуємо новий timestamp з безпечним TTL (60с)
    await env.LIKES_KV.put(spamKey, JSON.stringify({ ts: now }), {
      expirationTtl: SAFE_TTL_SEC,
    });

    // ---- Лічильник лайків ----
    const likesKey = kvLikesKey(chatId, messageId);

    let count = 0;
    try {
      const val = await env.LIKES_KV.get(likesKey);
      if (val) {
        const parsed = JSON.parse(val);
        const num = Number(parsed?.count);
        if (Number.isFinite(num) && num >= 0) count = num;
      }
    } catch (e) {
      console.warn("likes: parse KV error", e);
    }

    count += 1;
    await env.LIKES_KV.put(likesKey, JSON.stringify({ count }));

    const keyboard = {
      inline_keyboard: [[{ text: `❤️ ${count}`, callback_data: CB_INC }]],
    };
    await editMessageReplyMarkup(env, chatId, messageId, keyboard);

    await answerCallbackQuery(env, cqId);
  } catch (err) {
    console.error("likesOnCallback error:", err);
    // обовʼязково відповідаємо, щоб не висів «завантаження»
    await answerCallbackQuery(env, cqId, "Упс, щось пішло не так 😅");
  }
}

/* ===================== helpers ===================== */

function kvLikesKey(chatId: number, messageId: number) {
  return `likes:${chatId}:${messageId}`;
}
function kvSpamKey(chatId: number, messageId: number, userId: number) {
  return `likes_users:${chatId}:${messageId}:${userId}`;
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

  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
  let json: any | null = null;
  try { json = await res.json(); } catch {}
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
  const body = JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: replyMarkup });

  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
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

  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("answerCallbackQuery error:", res.status, errText);
  }
}