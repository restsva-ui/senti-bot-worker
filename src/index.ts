// src/index.ts
import type { TgUpdate } from "./types";
import { getCommands, findCommandByName, attachAI } from "./commands/registry";
import { sendMessage } from "./utils/telegram";

type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
  OWNER_ID?: string;
  LIKES_KV?: KVNamespace;

  // флаг фічі
  AI_ENABLED?: string;
};

const WEBHOOK_PATH = "/webhook";

function parseJson<T = unknown>(req: Request): Promise<T> {
  return req.json() as Promise<T>;
}

function isCommandEntity(update: TgUpdate) {
  const e = update.message?.entities?.[0];
  return e && e.type === "bot_command" && e.offset === 0;
}

function pickCmdToken(text: string | undefined): string | null {
  if (!text) return null;
  const m = text.match(/^\/(\w+)(?:@[\w_]+)?/);
  return (m?.[1] || "").toLowerCase() || null;
}

async function routeUpdate(env: Env, update: TgUpdate): Promise<void> {
  try {
    // оновлюємо реєстр з урахуванням фічі AI
    attachAI(String(env.AI_ENABLED).toLowerCase() === "true");

    // 1) якщо це команда — шукаємо та виконуємо
    if (isCommandEntity(update)) {
      const token = pickCmdToken(update.message?.text);
      if (token) {
        const fn = findCommandByName(token);
        if (fn) {
          await fn(env, update);
          return;
        } else {
          // невідома команда — тихо ігноруємо
          return;
        }
      }
    }

    // 2) сюди можна додати free-text хендлери (наприклад wiki-await) — на етапі 2

  } catch (err) {
    console.error("routeUpdate error:", err);
    const chatId = update.message?.chat?.id;
    if (chatId) {
      await sendMessage(env, chatId, "❌ Помилка у виконанні команди.", {
        parse_mode: "Markdown",
      }).catch(() => {});
    }
  }
}

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // health
    if (req.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, ts: Date.now() });
    }

    // webhook
    if (req.method === "POST" && url.pathname === WEBHOOK_PATH) {
      const update = await parseJson<TgUpdate>(req);
      console.info("update:", JSON.stringify(update));
      await routeUpdate(env, update);
      return new Response("OK");
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;