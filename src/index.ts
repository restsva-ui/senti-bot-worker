/* --------------------------- Env & Imports --------------------------- */
export type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;

  // --- Безпека вебхука ---
  WEBHOOK_SECRET?: string;

  // --- KV для антидублів (у тебе підключено як LIKES_KV = senti-state) ---
  LIKES_KV: KVNamespace;
};

import type { TgUpdate } from "./types";
import { sendMessage } from "./utils/telegram";

/* Команди */
import { startCommand } from "./commands/start";
import { pingCommand } from "./commands/ping";
import { healthCommand } from "./commands/health";
import { helpCommand } from "./commands/help";
import { wikiCommand } from "./commands/wiki";

/* --------------------------- Constants ------------------------------- */
const WEBHOOK_PATH = "/webhook/senti1984";

/* --------------------------- Registry -------------------------------- */
type Command = {
  name: string;
  description: string;
  execute: (env: Env, update: TgUpdate) => Promise<void>;
};

const commands: Record<string, Command> = {
  [startCommand.name]: startCommand,
  [pingCommand.name]: pingCommand,
  [healthCommand.name]: healthCommand,
  [helpCommand.name]: helpCommand,
  [wikiCommand.name]: wikiCommand,
};

/* --------------------------- Utils ----------------------------------- */
function parseJson<T = unknown>(req: Request): Promise<T> {
  return req.json() as Promise<T>;
}

function isCommand(msgText: string | undefined, name: string) {
  const t = msgText ?? "";
  const re = new RegExp(`^\\/${name}(?:@\\w+)?(?:\\s|$)`, "i");
  return re.test(t);
}

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

/** Антидубль: запам'ятати update_id на короткий час у KV. */
async function seenUpdateRecently(
  env: Env,
  updateId: number,
  ttlSec = 120
): Promise<boolean> {
  const key = `dedup:update:${updateId}`;
  const existed = await env.LIKES_KV.get(key);
  if (existed) return true;
  await env.LIKES_KV.put(key, "1", { expirationTtl: ttlSec });
  return false;
}

/* --------------------------- Router (Webhook) ------------------------ */
async function handleWebhook(env: Env, req: Request): Promise<Response> {
  // ---- Перевірка секрету вебхука (має бути на самому початку) ----
  const expected = env.WEBHOOK_SECRET;
  const got = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (expected && got !== expected) {
    console.warn("Webhook rejected: bad secret token");
    return new Response("forbidden", { status: 403 });
  }
  // ----------------------------------------------------------

  // Парсимо апдейт
  const update = await parseJson<TgUpdate>(req);

  // ---- Антидубль (KV) ----
  const updateId = (update as any)?.update_id as number | undefined;
  if (typeof updateId === "number") {
    const isDup = await seenUpdateRecently(env, updateId, 120); // 2 хвилини
    if (isDup) {
      // Тихий OK: апдейт уже оброблявся
      return new Response("OK");
    }
  }
  // ------------------------

  const msg = update.message;
  const text = msg?.text ?? "";

  // Визначаємо команду
  for (const key of Object.keys(commands)) {
    if (isCommand(text, key)) {
      await commands[key].execute(env, update);
      return new Response("OK");
    }
  }

  // Fallback: якщо команда не впізнана — тихий OK
  return new Response("OK");
}

/* --------------------------- Worker export --------------------------- */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // 1) Healthcheck (GET)
    if (req.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, ts: Date.now() });
    }

    // 2) Webhook (POST)
    if (req.method === "POST" && url.pathname === WEBHOOK_PATH) {
      try {
        return await handleWebhook(env, req);
      } catch (e) {
        console.error("webhook error:", e);
        // не витікаємо деталями у відповідь
        return new Response("OK");
      }
    }

    // 3) Інші методи/шляхи
    if (req.method !== "GET" && req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;