// Центральний роутер апдейта Telegram
// Зберігає існуючу логіку команд і додає: /help + callback_query

import { sendMessage, answerCallbackQuery } from "./telegram";
import { start } from "./commands/start";
import { ping } from "./commands/ping";
import { menu } from "./commands/menu";
import { likepanel } from "./commands/likepanel";
import { help } from "./commands/help";

type TGUser = { id: number };
type TGChat = { id: number };
type TGMessage = { message_id: number; from?: TGUser; chat: TGChat; text?: string };
type TGCallbackQuery = { id: string; from: TGUser; message?: TGMessage; data?: string };

type TGUpdate = {
  update_id: number;
  message?: TGMessage;
  callback_query?: TGCallbackQuery;
};

function extractCommand(text: string | undefined): string | null {
  if (!text) return null;
  if (!text.startsWith("/")) return null;
  const cmd = text.trim().split(/\s+/)[0].toLowerCase();
  return cmd;
}

export async function handleUpdate(update: TGUpdate): Promise<Response> {
  try {
    // 1) Повідомлення з командами
    if (update.message) {
      const chatId = update.message.chat.id;
      const cmd = extractCommand(update.message.text);

      if (cmd) {
        switch (cmd) {
          case "/start":
            await start(chatId);
            break;
          case "/ping":
            await ping(chatId);
            break;
          case "/menu":
            await menu(chatId);
            break;
          case "/likepanel":
            await likepanel(chatId);
            break;
          case "/help":
            await help(chatId);
            break;
          default:
            await sendMessage(chatId, "Невідома команда. Напишіть /help");
        }
      }
    }

    // 2) Обробка натискань інлайн-кнопок
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message?.chat.id;
      const data = cq.data;

      // Завжди відповідаємо на callback, щоб прибрати "loading..."
      await answerCallbackQuery(cq.id).catch(() => { /* no-op */ });

      if (chatId && data) {
        if (data === "cb_ping") {
          await ping(chatId);
        } else if (data === "cb_likepanel") {
          await likepanel(chatId);
        } else if (data === "cb_help") {
          await help(chatId);
        } else {
          await sendMessage(chatId, "🤷‍♂️ Невідома дія кнопки.");
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  } catch (err: any) {
    // Базове безпечне логування
    await (async () => {
      try {
        const e = typeof err?.message === "string" ? err.message : String(err);
        // якщо маєте ADMIN_CHAT_ID у конфігу — можна дублювати в адмін-чат
        // await sendMessage(ADMIN_CHAT_ID, `⚠️ Помилка: ${e}`);
        console.error("Router error:", e);
      } catch { /* ignore */ }
    })();

    return new Response(JSON.stringify({ ok: false, error: "internal" }), {
      headers: { "content-type": "application/json" },
      status: 500,
    });
  }
}