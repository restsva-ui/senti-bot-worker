// src/router.ts
import { sendMessage, answerCallback } from "./telegram/api";
import type { Update } from "./telegram/types";
import { CFG } from "./config";
import { cmdLikePanel } from "./commands/likepanel";
import { cmdKvTest, cmdResetLikes } from "./commands/kvdebug";

/** Виділяє команду з тексту: /ping, /ping@bot, /PING  */
function extractCommand(text?: string): string | null {
  if (!text || !text.startsWith("/")) return null;
  const first = text.trim().split(/\s+/)[0]; // "/ping" або "/ping@bot"
  const withoutMention = first.split("@")[0];
  return withoutMention.toLowerCase();
}

export async function routeUpdate(update: Update): Promise<void> {
  try {
    // 1) callback кнопки (лайки)
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message?.chat.id;
      if (!chatId) return;
      await answerCallback(cq.id, "✅ Прийнято");
      await cmdLikePanel(chatId, { data: cq.data || "" });
      return;
    }

    // 2) звичайні повідомлення
    const msg = update.message;
    if (!msg || !msg.text) return;

    const chatId = msg.chat.id;
    const raw = msg.text.trim();
    const lower = raw.toLowerCase();

    // A) Клавіатурні кнопки (без слеша)
    if (lower === "🔁 ping" || lower === "ping") {
      await sendMessage(chatId, "pong ✅");
      return;
    }
    if (lower === "👍 лайки") {
      await cmdLikePanel(chatId);
      return;
    }
    if (lower === "ℹ️ допомога" || lower === "допомога" || lower === "help") {
      await sendMessage(chatId,
`📄 Доступні команди:
/start — запуск і привітання
/ping — перевірка живості бота
/menu — головне меню
/likepanel — панель лайків
/kvtest — стан KV
/resetlikes — скинути лічильники`);
      return;
    }

    // B) Слеш-команди (з урахуванням @username)
    const cmd = extractCommand(raw);

    if (cmd === "/start") {
      await sendMessage(
        chatId,
        "👋 Привіт! Бот підключено до Cloudflare Workers. Напишіть /help для довідки."
      );
      return;
    }

    if (cmd === "/help") {
      await sendMessage(chatId,
`📄 Доступні команди:
/start — запуск і привітання
/ping — перевірка живості бота
/menu — головне меню
/likepanel — панель лайків
/kvtest — стан KV
/resetlikes — скинути лічильники`);
      return;
    }

    if (cmd === "/ping") {
      await sendMessage(chatId, "pong ✅");
      return;
    }

    if (cmd === "/menu") {
      await sendMessage(chatId, "Головне меню:", {
        reply_markup: {
          keyboard: [
            [{ text: "🔁 Ping" }],
            [{ text: "👍 Лайки" }],
            [{ text: "ℹ️ Допомога" }],
          ],
          resize_keyboard: true,
          one_time_keyboard: false,
        },
      });
      return;
    }

    if (cmd === "/likepanel") {
      await cmdLikePanel(chatId);
      return;
    }

    // Адмін-команди
    const isOwner = String(chatId) === String(CFG.ownerId);
    if (isOwner && cmd === "/kvtest") {
      await cmdKvTest(chatId);
      return;
    }
    if (isOwner && cmd === "/resetlikes") {
      await cmdResetLikes(chatId);
      return;
    }

    // C) Діагностичний фолбек (тимчасово, щоб переконатися, що апдейти доходять)
    await sendMessage(chatId, `🤖 Отримав: "${raw}" (cmd: ${cmd ?? "—"})`);
  } catch (e) {
    // Мʼякий захист, щоб не падати тихо
    try {
      const owner = Number(CFG.ownerId);
      if (owner) {
        await sendMessage(owner, `⚠️ Router error: ${(e as Error).message}`);
      }
    } catch { /* ignore */ }
  }
}