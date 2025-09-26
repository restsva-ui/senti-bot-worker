// src/router.ts
import { setEnv, type Env } from "./config";
import { sendMessage, answerCallbackQuery } from "./telegram/api";

import { cmdStart as start } from "./commands/start";
import { cmdPing as ping } from "./commands/ping";
import { menu } from "./commands/menu";
import { likepanel, handleLikeCallback } from "./commands/likepanel";
import { help } from "./commands/help";
import { diag } from "./commands/diag";              // ⚙️ діагностика
import { handleKVGet, handleKVList } from "./commands/kvdebug"; // 🧰 KV debug

// --- Мінімальні типи Telegram --------------------------
type TGUser = { id: number };
type TGChat = { id: number };
type TGMessage = { message_id: number; from?: TGUser; chat: TGChat; text?: string };
type TGCallbackQuery = { id: string; from: TGUser; message?: TGMessage; data?: string };
type TGUpdate = { update_id: number; message?: TGMessage; callback_query?: TGCallbackQuery };

// --- Хелпер для виділення команди ----------------------
function extractCommand(text?: string): string | null {
  if (!text || !text.startsWith("/")) return null;
  return text.trim().split(/\s+/)[0].toLowerCase();
}

// --- Основний обробник оновлень ------------------------
async function handleUpdate(update: TGUpdate): Promise<Response> {
  try {
    // 1) Команди в текстових повідомленнях
    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text ?? "";
      const cmd = extractCommand(text);

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
          case "/diag":
            await diag(chatId);
            break;

          // 🧰 Службові команди для перевірки KV (з чек-листа)
          case "/kvlist":
            await handleKVList(chatId);
            break;
          case "/kvget": {
            const [, key] = text.split(/\s+/, 2);
            if (!key) {
              await sendMessage(chatId, "❗ Використання: /kvget <ключ>");
            } else {
              await handleKVGet(chatId, key);
            }
            break;
          }

          default:
            // Невідома команда — підкажемо /help
            await sendMessage(chatId, "Невідома команда. Напишіть /help");
        }
      }
    }

    // 2) Обробка callback-кнопок
    if (update.callback_query) {
      const cq = update.callback_query;

      // прибрати «loading…» у Telegram
      await answerCallbackQuery(cq.id).catch(() => {});

      // Лайки/дизлайки (повертає true, якщо оброблено)
      if (await handleLikeCallback(update)) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }

      // Якщо дійшли сюди — невідома дія кнопки
      const chatId = cq.message?.chat.id;
      if (chatId) {
        await sendMessage(chatId, "🤷‍♂️ Невідома дія кнопки.");
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  } catch (err) {
    // fail-safe, щоб Telegram не відключив вебхук
    console.error("handleUpdate fatal:", err);
    return new Response(JSON.stringify({ ok: false }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }
}

// --- Фабрика для src/index.ts --------------------------
export function makeRouter() {
  return {
    async handle(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
      setEnv(env); // ініціалізуємо ENV для всього коду

      if (request.method === "POST") {
        const update = (await request.json().catch(() => ({}))) as TGUpdate;
        return handleUpdate(update);
      }

      // Простий healthcheck на GET
      return new Response("OK", { status: 200 });
    },
  };
}