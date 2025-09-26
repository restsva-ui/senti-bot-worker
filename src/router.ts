// src/router.ts
import { setEnv, type Env, CFG, getCfg } from "./config";
import { sendMessage, answerCallbackQuery } from "./telegram/api";
import { cmdStart as start } from "./commands/start";
import { cmdPing as ping } from "./commands/ping";
import { menu } from "./commands/menu";
import { likepanel, handleLikeCallback } from "./commands/likepanel";
import { help } from "./commands/help";

// --- Мінімальні типи Telegram ---
type TGUser = { id: number };
type TGChat = { id: number };
type TGMessage = {
  message_id: number;
  from?: TGUser;
  chat: TGChat;
  text?: string;
};
type TGCallbackQuery = {
  id: string;
  from: TGUser;
  message?: TGMessage;
  data?: string;
};
type TGUpdate = {
  update_id: number;
  message?: TGMessage;
  callback_query?: TGCallbackQuery;
};

// --- Утиліти ---
function extractCommand(text?: string): string | null {
  if (!text || !text.startsWith("/")) return null;
  return text.trim().split(/\s+/)[0].toLowerCase();
}

function isFromTelegram(req: Request): boolean {
  // якщо секрет НЕ заданий — пропускаємо всіх (зручно під час налаштування з мобільного)
  const secret = getCfg("webhookSecret");
  if (!secret) return true;
  const got = req.headers.get("x-telegram-bot-api-secret-token") || "";
  return got === secret;
}

// --- Головний обробник оновлень ---
async function handleUpdate(update: TGUpdate): Promise<Response> {
  try {
    // 1) Команди у повідомленнях
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
          case "/diag": {
            const lines = [
              "🧪 Діагностика Senti",
              "",
              `Telegram API base: ${getCfg("apiBase")}`,
              `BOT_TOKEN: ${getCfg("botToken") ? "✅" : "❌"}`,
              "",
              "🛠️ Моделі:",
              `OpenRouter key: ${getCfg("openrouterKey") ? "✅" : "❌"}`,
              `OpenRouter model: ${getCfg("openrouterModel")}`,
              `OpenRouter vision: ${getCfg("openrouterVisionModel")}`,
              "",
              "⚙️ Інше:",
              `CF AI Gateway: ${getCfg("cfAiGatewayBase") ? "✅" : "—"}`,
              `OWNER_ID: ${getCfg("ownerId") || "—"}`,
            ];
            await sendMessage(chatId, lines.join("\n"));
            break;
          }
          default:
            await sendMessage(
              chatId,
              "Невідома команда. Напишіть /help"
            );
        }
      }
    }

    // 2) callback-кнопки
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message?.chat.id;
      const data = cq.data;

      // прибираємо “loading…”
      await answerCallbackQuery(cq.id).catch(() => {});

      // лайки (повертає true, якщо оброблено)
      if (await handleLikeCallback(update)) {
        return jsonOk();
      }

      if (chatId && data) {
        if (data === "cb_ping") await ping(chatId);
        else if (data === "cb_help") await help(chatId);
        else await sendMessage(chatId, "🤷‍♂️ Невідома дія кнопки.");
      }
    }

    return jsonOk();
  } catch (e) {
    // щоб бачити фейли навіть без Logpush
    console.error("handleUpdate fatal:", (e as Error)?.message || e);
    return jsonOk();
  }
}

function jsonOk() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

// --- Публічна фабрика роутера, як очікує src/index.ts ---
export function makeRouter() {
  return {
    async handle(request: Request, env: Env, _ctx: ExecutionContext) {
      setEnv(env);

      // Базовий healthcheck
      if (request.method === "GET") {
        return new Response("OK", { status: 200 });
      }

      // Приймаємо лише валідні POST-и (секрет опційний)
      if (request.method !== "POST" || !isFromTelegram(request)) {
        return new Response("OK", { status: 200 });
      }

      const update = (await request.json().catch(() => ({}))) as TGUpdate;
      return handleUpdate(update);
    },
  };
}