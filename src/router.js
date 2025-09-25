// src/router.js
import { sendMessage, answerCallbackQuery, editMessageText } from "./lib/tg.js";

// Команди — підключаємо без жорсткої прив'язки до назв експортів,
// щоб не зламатися, якщо файл тимчасово не має потрібної функції.
import * as Menu from "./commands/menu.js";
import * as Stats from "./commands/stats.js";
import * as LikePanel from "./commands/likepanel.js";

/**
 * Головний роутер апдейта від Telegram
 * @param {Env} env
 * @param {*} update
 */
export async function routeUpdate(env, update) {
  // 1) callback_query (натискання інлайн-кнопок)
  if (update.callback_query) {
    const cq = update.callback_query;
    const data = cq.data || "";
    const chatId = cq.message?.chat?.id;
    const messageId = cq.message?.message_id;

    // лайки — делегуємо, якщо є обробник
    if (data.startsWith("like:")) {
      if (typeof LikePanel.onLikePanelCallback === "function") {
        return LikePanel.onLikePanelCallback(env, update);
      }
      // fallback: просто підтвердимо натискання
      await answerCallbackQuery(env, cq.id, { text: "👍" });
      return;
    }

    // відкриття панелі лайків з кнопки
    if (data === "likepanel") {
      if (typeof LikePanel.onLikePanel === "function") {
        return LikePanel.onLikePanel(env, update);
      }
      await answerCallbackQuery(env, cq.id, { text: "Панель лайків недоступна" });
      return;
    }

    // статистика
    if (data === "stats") {
      if (typeof Stats.onStats === "function") {
        return Stats.onStats(env, update);
      }
      await answerCallbackQuery(env, cq.id, { text: "Статистика недоступна" });
      return;
    }

    // about
    if (data === "about") {
      await editMessageText(
        env,
        chatId,
        messageId,
        "🤖 Senti — бот на Cloudflare Workers. Команди: /menu, /stats, /likepanel"
      );
      await answerCallbackQuery(env, cq.id);
      return;
    }

    // за замовчуванням — просто підтвердити клік
    await answerCallbackQuery(env, cq.id);
    return;
  }

  // 2) звичайні повідомлення
  const msg = update.message || update.edited_message;
  if (!msg) return;

  const text = (msg.text || "").trim();
  const chatId = msg.chat?.id;

  // Команди через слеш
  if (text.startsWith("/")) {
    const [cmd] = text.split(/\s+/, 1);
    switch (cmd) {
      case "/menu":
        if (typeof Menu.onMenu === "function") {
          return Menu.onMenu(env, update);
        }
        return sendMessage(env, chatId, "📋 Меню тимчасово недоступне.");

      case "/stats":
        if (typeof Stats.onStats === "function") {
          return Stats.onStats(env, update);
        }
        return sendMessage(env, chatId, "📊 Статистика тимчасово недоступна.");

      case "/likepanel":
        if (typeof LikePanel.onLikePanel === "function") {
          return LikePanel.onLikePanel(env, update);
        }
        return sendMessage(env, chatId, "👍 Панель лайків тимчасово недоступна.");

      // інші ваші існуючі команди (/start, /ping, /kvset, /kvget)
      // обробляються у вашому поточному index.js — тут нічого не змінюємо.
      default:
        // Нехай базова логіка з index.js опрацює це як звичайний текст
        return; // нічого не робимо в роутері
    }
  }

  // Якщо це просто текст — теж нічого не робимо:
  // поточна “ехо/старт” логіка лишається у вашому index.js.
  return;
}

export default { routeUpdate };