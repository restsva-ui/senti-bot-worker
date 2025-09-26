// src/router.ts
// Центральний роутер Telegram-апдейтів.
// ✅ ЗБЕРЕЖЕНО поточну логіку команд (/start, /ping, /menu, /likepanel, /help)
// ✅ ДОДАНО безпечне виконання кроків з централізованим логуванням (runSafe)

import { sendMessage, answerCallbackQuery } from "./telegram";
import { cmdStart as start } from "./commands/start";
import { cmdPing as ping } from "./commands/ping";
import { menu } from "./commands/menu";
import { help } from "./commands/help";
// якщо у вас інша назва/експорт у likepanel.ts — залиште як було у вас
import { likepanel } from "./commands/likepanel";

type TGUser = { id: number };
type TGChat = { id: number };
type TGMessage = { message_id: number; from?: TGUser; chat: TGChat; text?: string };
type TGCallbackQuery = { id: string; from: TGUser; message?: TGMessage; data?: string };

type TGUpdate = {
  update_id: number;
  message?: TGMessage;
  callback_query?: TGCallbackQuery;
};

// -----------------------
// helpers
// -----------------------
function extractCommand(text: string | undefined): string | null {
  if (!text) return null;
  const t = text.trim();
  if (!t.startsWith("/")) return null;
  return t.split(/\s+/)[0].toLowerCase();
}

/**
 * Централізована обгортка кроків з логуванням помилок.
 * НЕ кидає помилку догори — щоб один збій не валив увесь апдейт.
 */
async function runSafe<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err: any) {
    const msg = typeof err?.message === "string" ? err.message : String(err);
    console.error(`[router] step "${label}" failed:`, msg);
    return undefined;
  }
}

// -----------------------
// main handler
// -----------------------
export async function handleUpdate(update: TGUpdate): Promise<Response> {
  try {
    // 1) Команди у звичайних повідомленнях
    if (update.message) {
      const chatId = update.message.chat.id;
      const cmd = extractCommand(update.message.text);

      if (cmd) {
        switch (cmd) {
          case "/start":
            await runSafe("command:/start", async () => {
              await start(chatId);
            });
            break;

          case "/ping":
            await runSafe("command:/ping", async () => {
              await ping(chatId);
            });
            break;

          case "/menu":
            await runSafe("command:/menu", async () => {
              await menu(chatId);
            });
            break;

          case "/likepanel":
            await runSafe("command:/likepanel", async () => {
              // якщо ваш likepanel потребує інші аргументи — підставте як у вас
              await likepanel(chatId);
            });
            break;

          case "/help":
            await runSafe("command:/help", async () => {
              await help(chatId);
            });
            break;

          default:
            await runSafe("command:unknown", async () => {
              await sendMessage(chatId, "Невідома команда. Напишіть /help");
            });
        }
      }
    }

    // 2) Обробка інлайн-кнопок (callback_query)
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message?.chat.id;
      const data = cq.data;

      // завжди відповідаємо на callback — прибирає "loading…"
      await runSafe("callback:answer", async () => {
        await answerCallbackQuery(cq.id);
      });

      if (chatId && data) {
        await runSafe(`callback:data:${data}`, async () => {
          if (data === "cb_ping") {
            await ping(chatId);
          } else if (data === "cb_likepanel") {
            await likepanel(chatId);
          } else if (data === "cb_help") {
            await help(chatId);
          } else {
            await sendMessage(chatId, "🤷‍♂️ Невідома дія кнопки.");
          }
        });
      }
    }

    // 200 OK навіть якщо щось впало всередині — помилки вже залоговано
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err: any) {
    // Фінальна «страховка» на весь апдейт
    const msg = typeof err?.message === "string" ? err.message : String(err);
    console.error("[router] unhandled error:", msg);

    // Повертаємо 200, щоб Telegram не повторював апдейт безкінечно.
    // Якщо хочете іншу семантику — змініть на 500.
    return new Response(JSON.stringify({ ok: false, error: "internal" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
}