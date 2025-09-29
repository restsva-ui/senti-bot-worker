// src/commands/stats.ts
import type { TgUpdate } from "../types";

/**
 * /stats — підсумок лайків у поточному чаті.
 * Формат ключів у KV: likes:<chatId>:<messageId>
 */
export const statsCommand = {
  name: "stats",
  description: "Показує суму всіх ❤️ у чаті та кількість повідомлень із лайками",
  async execute(
    env: { BOT_TOKEN: string; API_BASE_URL?: string; LIKES_KV: KVNamespace },
    update: TgUpdate
  ) {
    const msg = update.message;
    const chatId = msg?.chat?.id;
    if (!chatId) return;

    const prefix = `likes:${chatId}:`;
    let totalLikes = 0;
    let messagesWithLikes = 0;

    // Пагінація KV.list
    let cursor: string | undefined = undefined;
    const LIMIT = 100;      // елементів за один list
    const MAX_KEYS = 1000;  // захист від надмірних витрат
    let scanned = 0;

    outer: while (true) {
      const page = await env.LIKES_KV.list({ prefix, cursor, limit: LIMIT });
      for (const k of page.keys) {
        if (scanned >= MAX_KEYS) break outer;
        scanned++;

        try {
          const val = await env.LIKES_KV.get(k.name);
          if (!val) continue;
          const parsed = JSON.parse(val);
          const n = Number(parsed?.count);
          if (Number.isFinite(n) && n > 0) {
            totalLikes += n;
            messagesWithLikes++;
          }
        } catch {
          // ігноруємо зламані значення
        }
      }
      if (page.list_complete || scanned >= MAX_KEYS) break;
      cursor = page.cursor;
    }

    const truncated = scanned >= MAX_KEYS ? "\n(⚠️ підрахунок обрізано на 1000 ключах)" : "";
    const text = [
      "📊 <b>Статистика лайків</b>",
      `Повідомлень із лайками: <b>${messagesWithLikes}</b>`,
      `Усього ❤️: <b>${totalLikes}</b>`,
      truncated,
    ].join("\n");

    await sendMessage(env, chatId, text, { parse_mode: "HTML" });
  },
} as const;

/* -------------------- low-level telegram -------------------- */
async function sendMessage(
  env: { BOT_TOKEN: string; API_BASE_URL?: string },
  chatId: number,
  text: string,
  extra?: Record<string, unknown>
) {
  const apiBase = env.API_BASE_URL || "https://api.telegram.org";
  const url = `${apiBase}/bot${env.BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text, ...extra });

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("sendMessage error:", res.status, errText);
  }
}