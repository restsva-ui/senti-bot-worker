// src/router.ts
import { setEnv, type Env } from "./config";
import { sendMessage, answerCallbackQuery } from "./telegram/api";
import { cmdStart as start } from "./commands/start";
import { cmdPing as ping } from "./commands/ping";
import { menu } from "./commands/menu";
import { likepanel, handleLikeCallback } from "./commands/likepanel";
import { help } from "./commands/help";

// Типи Telegram (мінімально потрібні)
type TGUser = { id: number };
type TGChat = { id: number };
type TGMessage = { message_id: number; from?: TGUser; chat: TGChat; text?: string };
type TGCallbackQuery = { id: string; from: TGUser; message?: TGMessage; data?: string };
type TGUpdate = { update_id: number; message?: TGMessage; callback_query?: TGCallbackQuery };

function extractCommand(text?: string): string | null {
  if (!text || !text.startsWith("/")) return null;
  return text.trim().split(/\s+/)[0].toLowerCase();
}

async function handleUpdate(update: TGUpdate): Promise<Response> {
  // 1) Команди (повідомлення)
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

  // 2) callback-кнопки
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat.id;
    const data = cq.data;

    // перш за все прибираємо "loading…"
    await answerCallbackQuery(cq.id).catch(() => {});

    // лайки (повертає true, якщо оброблено)
    if (await handleLikeCallback(update)) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }

    if (chatId && data) {
      if (data === "cb_ping") await ping(chatId);
      else if (data === "cb_help") await help(chatId);
      else await sendMessage(chatId, "🤷‍♂️ Невідома дія кнопки.");
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

// Публічний фабричний метод, якого очікує src/index.ts
export function makeRouter() {
  return {
    async handle(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
      setEnv(env); // ініціалізуємо доступ до ENV для всього коду

      if (request.method === "POST") {
        const update = (await request.json().catch(() => ({}))) as TGUpdate;
        return handleUpdate(update);
      }

      // Простий healthcheck на GET
      return new Response("OK", { status: 200 });
    },
  };
}