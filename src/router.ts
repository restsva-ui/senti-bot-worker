// Центральний роутер апдейта Telegram
// ✔ Перевіряє шлях вебхука та секретний заголовок
// ✔ Акуратно парсить JSON (без 500 при помилках)
// ✔ Логує все потрібне в Workers Logs
// ✔ Зберігає існуючу логіку команд + callback

import { setEnv, type Env } from "./config";
import { sendMessage, answerCallbackQuery } from "./telegram/api";
import { cmdStart as start } from "./commands/start";
import { cmdPing as ping } from "./commands/ping";
import { menu } from "./commands/menu";
import { likepanel, handleLikeCallback } from "./commands/likepanel";
import { help } from "./commands/help";

// ❗️має збігатися з тим, що ти задав у setWebhook (і в URL)
const WEBHOOK_SECRET = "senti1984";

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
  // 1) Повідомлення-команди
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

  // 2) Інлайн-кнопки (callback_query)
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat.id;
    const data = cq.data;

    // прибираємо “loading…”
    await answerCallbackQuery(cq.id).catch(() => {});

    // лайки (повертає true, якщо оброблено)
    try {
      const handled = await handleLikeCallback(update);
      if (handled) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }
    } catch (e) {
      // не валимо апдейт — просто залогуємо
      console.error("handleLikeCallback error:", (e as Error)?.message ?? e);
    }

    if (chatId && data) {
      if (data === "cb_ping") {
        await ping(chatId);
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
}

// Публічний фабричний метод, який очікує src/index.ts
export function makeRouter() {
  return {
    async handle(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
      setEnv(env); // ініціалізуємо доступ до ENV для всього коду

      const url = new URL(request.url);
      const path = url.pathname;

      // Healthcheck на GET /
      if (request.method === "GET") {
        if (path === "/" || path === "") return new Response("OK", { status: 200 });
        return new Response("Not found", { status: 404 });
      }

      // Приймаємо тільки POST на точний шлях вебхука
      if (request.method !== "POST" || path !== `/webhook/${WEBHOOK_SECRET}`) {
        console.warn("Unexpected request:", request.method, path);
        return new Response("Not found", { status: 404 });
      }

      // Перевірка секретного заголовка від Telegram
      const hdrSecret = request.headers.get("x-telegram-bot-api-secret-token");
      if (hdrSecret !== WEBHOOK_SECRET) {
        console.error("Secret header mismatch", { got: hdrSecret });
        // Важливо: 403, щоб Telegram одразу зрозумів, що URL/secret некоректні
        return new Response("Forbidden", { status: 403 });
      }

      // Безпечний JSON-парсинг
      let update: TGUpdate | null = null;
      try {
        update = (await request.json()) as TGUpdate;
      } catch (e) {
        console.error("Update JSON parse error:", (e as Error)?.message ?? e);
        // 200, щоб Telegram не ретраїв сміття
        return new Response(JSON.stringify({ ok: false, error: "bad_json" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }

      // Трохи корисних логів (увімкни Workers Logs)
      try {
        console.log("Incoming update (short):", {
          hasMessage: !!update?.message,
          hasCallback: !!update?.callback_query,
          mid: update?.message?.message_id,
          chat: update?.message?.chat?.id ?? update?.callback_query?.message?.chat?.id,
        });
      } catch {}

      // Обробка апдейта з catch-all, щоб не віддавати 500
      try {
        return await handleUpdate(update!);
      } catch (e) {
        console.error("handleUpdate fatal:", (e as Error)?.message ?? e);
        return new Response(JSON.stringify({ ok: false, error: "internal" }), {
          headers: { "content-type": "application/json" },
          status: 200, // 200, щоб Telegram не заспамив ретраями
        });
      }
    },
  };
}