/* --------------------------- Env & Imports --------------------------- */
export type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
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

/* --------------------------- Router (Webhook) ------------------------ */
async function handleWebhook(env: Env, req: Request): Promise<Response> {
  const update = await parseJson<TgUpdate>(req);

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