// src/router.ts
import type { Env } from "./index";
import { handleStart } from "./commands/start";
import { handlePing } from "./commands/ping";
import { handleMenu } from "./commands/menu";
import { handleLikePanel } from "./commands/likepanel";

// невеличкий util для Telegram API
async function tgCall(env: Env, method: string, payload: any) {
  const base = env.API_BASE_URL || "https://api.telegram.org";
  const url = `${base}/bot${env.BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("TG_API_ERROR", { method, status: res.status, text });
    throw new Error(`Telegram API ${method} failed`);
  }
  return res.json();
}

async function sendText(env: Env, chat_id: number | string, text: string) {
  return tgCall(env, "sendMessage", { chat_id, text, parse_mode: "HTML" });
}

function getPathname(req: Request) {
  try {
    return new URL(req.url).pathname;
  } catch {
    return "/";
  }
}

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

export function makeRouter() {
  return {
    async handle(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method.toUpperCase();

      // 1) root / health
      if (method === "GET" && (path === "/" || path === "/health")) {
        return new Response("Hello from Worker!", { status: 200 });
      }

      // 2) тестове повідомлення: /test?chat_id=...&text=...
      if (method === "GET" && path === "/test") {
        const chatId = url.searchParams.get("chat_id");
        const text = url.searchParams.get("text") || "Test OK ✅";
        if (!chatId) return json({ ok: false, error: "chat_id required" }, { status: 400 });
        try {
          const r = await sendText(env, chatId, text);
          return json({ ok: true, result: r });
        } catch (e: any) {
          return json({ ok: false, error: e?.message || "send failed" }, { status: 500 });
        }
      }

      // 3) Telegram webhook: /webhook/<WEBHOOK_SECRET>
      if (method === "POST" && path === `/webhook/${env.WEBHOOK_SECRET}`) {
        let update: any;
        try {
          update = await req.json();
        } catch {
          return json({ ok: false, error: "invalid JSON" }, { status: 400 });
        }

        // базове розгалуження на команди
        try {
          const msg = update?.message;
          const text: string | undefined = msg?.text;
          const chatId = msg?.chat?.id;

          if (text?.startsWith("/start")) {
            await handleStart(update, env, { sendText, tgCall });
          } else if (text?.startsWith("/ping")) {
            await handlePing(update, env, { sendText, tgCall });
          } else if (text?.startsWith("/menu")) {
            await handleMenu(update, env, { sendText, tgCall });
          } else if (text?.startsWith("/likepanel")) {
            await handleLikePanel(update, env, { sendText, tgCall });
          } else if (chatId && text) {
            // дефолтна відповідь на звичайний текст
            await sendText(env, chatId, "👋 Привіт! Бот підключено до Cloudflare Workers.");
          }

          return json({ ok: true });
        } catch (err: any) {
          console.error("WEBHOOK_HANDLER_ERROR", { message: err?.message, stack: err?.stack });
          // важливо: Telegram очікує 200, щоб не ретраїв безкінечно
          return json({ ok: true });
        }
      }

      // 4) 404
      return new Response("Not Found", { status: 404 });
    },
  };
}