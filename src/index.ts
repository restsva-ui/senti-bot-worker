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

// 1) Надійний дешифратор /команди
function extractCommand(text: string | undefined, botUsername?: string): string | null {
  if (!text) return null;
  // варіант 1: починається з /cmd або /cmd@bot
  const m = text.match(/^\/([a-zA-Z0-9_]+)(?:@([a-zA-Z0-9_]+))?/);
  if (m) {
    const [, name, atUser] = m;
    if (!atUser || !botUsername || atUser.toLowerCase() === botUsername.toLowerCase()) {
      return name.toLowerCase();
    }
  }
  return null;
}

async function routeUpdate(env: Env, update: TgUpdate): Promise<void> {
  // Увімк/вимкнути AI на кожному апдейті (дешево і просто)
  attachAI(String(env.AI_ENABLED).toLowerCase() === "true");

  const msg = update.message;
  const chatId = msg?.chat?.id;

  // username бота інколи Телеграм підкидає в текст /cmd@MyBot
  // якщо ти його зберігаєш у змінних — додай; якщо ні, просто працюємо без нього
  const botUsername = undefined;

  const text = msg?.text ?? "";
  const cmd = extractCommand(text, botUsername);

  console.log("update text =", text);
  console.log("parsed cmd =", cmd);

  if (!cmd) {
    // сюди можна навісити вільний текст (wiki-await)
    return;
  }

  const handler = findCommandByName(cmd);
  console.log("handler found =", !!handler);

  if (!handler) {
    if (chatId) {
      await sendMessage(env as any, chatId, "❌ Невідома команда.");
    }
    return;
  }

  try {
    await handler(env as any, update);
  } catch (err) {
    console.error("handler error:", err);
    if (chatId) {
      await sendMessage(env as any, chatId, "❌ Помилка у виконанні команди.");
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
      // без очікування відповіді Телеграму — віддамо 200 і обробимо у фоні
      routeUpdate(env, update).catch((e) => console.error("routeUpdate fail:", e));
      return new Response("OK");
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;