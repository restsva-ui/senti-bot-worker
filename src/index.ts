// Точка входу Cloudflare Worker для Telegram-бота.
// ПРИМІТКА: використовуємо BOT_TOKEN (fallback на TELEGRAM_BOT_TOKEN для сумісності).

import { COMMANDS, wikiMaybeHandleFreeText } from "./commands/registry";

type Json = Record<string, any>;

export interface Env {
  // головна назва змінної
  BOT_TOKEN?: string;
  // запасна (на випадок, якщо десь лишилась стара назва)
  TELEGRAM_BOT_TOKEN?: string;

  // Базовий URL Telegram API (необов'язковий; за замовченням — офіційний)
  API_BASE_URL?: string;

  // (необов'язково) секрет токена для перевірки заголовка X-Telegram-Bot-Api-Secret-Token
  TELEGRAM_SECRET_TOKEN?: string;

  // інші ваші змінні також можна описати тут…
  AI_ENABLED?: string;
}

function jsonResponse(data: Json, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function getBotToken(env: Env): string {
  const token = env.BOT_TOKEN ?? env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is missing");
  return token;
}

function getApiBase(env: Env): string {
  return (env.API_BASE_URL || "https://api.telegram.org").replace(/\/+$/, "");
}

async function callTelegram(env: Env, method: string, payload: Json) {
  const token = getBotToken(env);
  const base = getApiBase(env);
  const url = `${base}/bot${token}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Telegram API ${method} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function sendMessage(env: Env, chat_id: number | string, text: string, opts: Json = {}) {
  return callTelegram(env, "sendMessage", {
    chat_id,
    text,
    ...{ parse_mode: "Markdown" },
    ...opts,
  });
}

function isFromTelegram(req: Request, env: Env): boolean {
  // Якщо TELEGRAM_SECRET_TOKEN задано — перевіряємо заголовок.
  const expected = env.TELEGRAM_SECRET_TOKEN;
  if (!expected) return true;
  const got = req.headers.get("x-telegram-bot-api-secret-token");
  return got === expected;
}

function parseCommand(text: string): { cmd: string; args: string } | null {
  if (!text || text[0] !== "/") return null;
  // відрізаємо /cmd@bot та аргументи
  const firstSpace = text.indexOf(" ");
  const head = (firstSpace === -1 ? text : text.slice(0, firstSpace)).trim();
  const args = (firstSpace === -1 ? "" : text.slice(firstSpace + 1)).trim();

  // /cmd@username -> /cmd
  const cmd = head.replace(/^\/([^@\s]+)(?:@[\w_]+)?$/, "$1");
  return { cmd, args };
}

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(req.url);
      const { pathname } = url;

      // 1) Healthcheck
      if (req.method === "GET" && pathname === "/health") {
        return jsonResponse({ ok: true, ts: nowTs() });
      }

      // 2) Root/info (необов'язково)
      if (req.method === "GET" && pathname === "/") {
        return jsonResponse({ ok: true, name: "senti-bot-worker", ts: nowTs() });
      }

      // 3) Telegram webhook
      if (pathname === "/webhook") {
        if (!isFromTelegram(req, env)) {
          return jsonResponse({ ok: false, error: "forbidden" }, 403);
        }
        if (req.method !== "POST") {
          return jsonResponse({ ok: true, note: "use POST" });
        }

        let update: any;
        try {
          update = await req.json();
        } catch {
          return jsonResponse({ ok: false, error: "bad json" }, 400);
        }

        const msg = update.message;
        const cbq = update.callback_query;
        const chatId: number | undefined =
          msg?.chat?.id ?? cbq?.message?.chat?.id;

        // Якщо це звичайне повідомлення з текстом
        const text: string | undefined = msg?.text;

        // 3.1 Якщо є команда — роутимо через COMMANDS
        const parsed = text ? parseCommand(text) : null;

        if (parsed && chatId) {
          const { cmd, args } = parsed;
          const handler = (COMMANDS as any)[cmd];

          if (typeof handler === "function") {
            try {
              const ctx = {
                env,
                update,
                chatId,
                text,
                args,
                sendMessage: (t: string, opts: Json = {}) => sendMessage(env, chatId, t, opts),
              };
              const res = await handler(ctx, args);
              // якщо хендлер нічого не відправив — даємо м'яку відповідь
              if (res === undefined) {
                // нічого
              }
            } catch (e: any) {
              await sendMessage(env, chatId, `⚠️ Помилка команди: ${e?.message || e}`);
            }
          } else {
            // невідома команда
            await sendMessage(env, chatId, "🙈 Невідома команда. Спробуй /help");
          }

          return jsonResponse({ ok: true });
        }

        // 3.2 Якщо вмикнено логіку очікування для wiki — делегуємо
        if (!parsed && chatId && typeof wikiMaybeHandleFreeText === "function") {
          const handled = await wikiMaybeHandleFreeText({
            env,
            update,
            chatId,
            text,
            sendMessage: (t: string, opts: Json = {}) => sendMessage(env, chatId, t, opts),
          });
          if (handled) return jsonResponse({ ok: true, routed: "wiki-free-text" });
        }

        // 3.3 Інакше — мовчазно ок
        return jsonResponse({ ok: true });
      }

      // 4) Якщо шлях невідомий
      return jsonResponse({ ok: false, error: "not found" }, 404);
    } catch (e: any) {
      // Глобальний захист, щоб воркер не падав.
      return jsonResponse({ ok: false, error: e?.message || String(e) }, 500);
    }
  },
};