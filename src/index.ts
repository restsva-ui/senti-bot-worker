// src/index.ts
import type { TgUpdate } from "./types";
import { findCommandByName, attachAI } from "./commands/registry";
import { sendMessage } from "./utils/telegram";

type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
  OWNER_ID?: string;
  LIKES_KV?: KVNamespace;
  AI_ENABLED?: string; // "true" | "false"
};

const WEBHOOK_PATH = "/webhook";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
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
    // вмикаємо/вимикаємо AI в реєстрі кожен апдейт (дешево і надійно)
    attachAI(String(env.AI_ENABLED).toLowerCase() === "true");

    if (isCommandEntity(update)) {
      const cmd = pickCmdToken(update.message?.text);
      const handler = cmd ? findCommandByName(cmd) : undefined;
      if (handler) {
        await handler(env as any, update);
        return;
      }
    }

    // тут можна обробляти free-text (wiki-await) — додамо окремо

  } catch (err) {
    console.error("routeUpdate error:", err);
    const chatId = update.message?.chat?.id;
    if (chatId) {
      await sendMessage(env as any, chatId, "❌ Помилка у виконанні команди.").catch(() => {});
    }
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, ts: Date.now() });
    }

    if (req.method === "POST" && url.pathname === WEBHOOK_PATH) {
      const update = (await req.json()) as TgUpdate;
      await routeUpdate(env, update);
      return new Response("OK");
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;