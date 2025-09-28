// src/index.ts
/* --------------------------- Env & Imports --------------------------- */
export type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string; // optional, default https://api.telegram.org
};

import { sendMessage } from "./utils/telegram";
import { cmdWiki } from "./commands/wiki";

/* --------------------------- Constants -------------------------------- */
const WEBHOOK_PATH = "/webhook/senti1984";

/* --------------------------- Types ----------------------------------- */
type TgUser = { language_code?: string };
type TgChat = { id: number };
type TgEntity = { offset: number; length: number; type: string };
type TgMessage = {
  text?: string;
  chat: TgChat;
  from?: TgUser;
  entities?: TgEntity[];
};
type TgUpdate = { message?: TgMessage };

/* --------------------------- Utils ----------------------------------- */
function parseJson<T = unknown>(req: Request): Promise<T> {
  return req.json() as Promise<T>;
}

function helpText() {
  return [
    "Доступні команди:",
    "",
    "/start – запуск і вітання",
    "/ping – перевірка звʼязку (відповідь: pong)",
    "/health – перевірка стану сервера",
    "/help – список команд",
    "/wiki <запит> – коротка довідка з Вікіпедії (безкоштовно)",
    "",
    "⚡ У майбутньому тут зʼявляться нові функції (AI, інтеграції тощо).",
  ].join("\n");
}

/** Надійний парсер команди з повідомлення (через entities) */
function extractCommand(msg?: TgMessage): { name?: string; args?: string } {
  if (!msg?.text) return {};
  const text = msg.text;

  // 1) Спроба через entities
  const cmdEnt = msg.entities?.find((e) => e.type === "bot_command");
  if (cmdEnt) {
    const raw = text.substring(cmdEnt.offset, cmdEnt.offset + cmdEnt.length); // напр. "/help@my_bot"
    const args = text.substring(cmdEnt.offset + cmdEnt.length).trim(); // решта після команди
    const lower = raw.toLowerCase();
    // відкидаємо @botname
    const name = lower.startsWith("/")
      ? lower.slice(1).split("@")[0]
      : lower.split("@")[0];
    return { name, args };
  }

  // 2) Фолбек на regex (на випадок відсутніх entities)
  const m = text.trim().match(/^\/([a-z0-9_]+)(?:@\w+)?(?:\s+(.+))?$/i);
  if (m) {
    return {
      name: m[1].toLowerCase(),
      args: (m[2] ?? "").trim(),
    };
  }
  return {};
}

/* --------------------------- Command handlers ------------------------ */
async function cmdStart(env: Env, update: TgUpdate) {
  const chatId = update.message!.chat.id;
  await sendMessage(env, chatId, "✅ Senti онлайн\nНадішли /ping щоб перевірити відповідь.");
}
async function cmdPing(env: Env, update: TgUpdate) {
  const chatId = update.message!.chat.id;
  await sendMessage(env, chatId, "pong ✅");
}
async function cmdHealth(env: Env, update: TgUpdate) {
  const chatId = update.message!.chat.id;
  await sendMessage(env, chatId, "ok ✅");
}
async function cmdHelp(env: Env, update: TgUpdate) {
  const chatId = update.message!.chat.id;
  await sendMessage(env, chatId, helpText());
}

/* --------------------------- Webhook router -------------------------- */
async function handleWebhook(env: Env, req: Request): Promise<Response> {
  const update = await parseJson<TgUpdate>(req);
  console.log("[webhook] raw update:", JSON.stringify(update));

  const msg = update.message;
  if (!msg) return new Response("OK");

  const { name } = extractCommand(msg);
  console.log("[webhook] command parsed:", name, "text:", msg.text);

  switch (name) {
    case "start":
      await cmdStart(env, update);
      break;
    case "ping":
      await cmdPing(env, update);
      break;
    case "health":
      await cmdHealth(env, update);
      break;
    case "help":
      await cmdHelp(env, update);
      break;
    case "wiki":
      await cmdWiki(env, update); // сам хендлер обробляє відсутні аргументи
      break;
    default:
      // не команда — ігноруємо
      break;
  }
  return new Response("OK");
}

/* --------------------------- Helpers --------------------------------- */
function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

/* --------------------------- Admin endpoints ------------------------- */
async function registerBotCommands(env: Env): Promise<Response> {
  const body = {
    commands: [
      { command: "start",  description: "Start dialog" },
      { command: "ping",   description: "Test reply" },
      { command: "health", description: "Worker health" },
      { command: "help",   description: "Show help" },
      { command: "wiki",   description: "Wiki summary" },
    ],
    scope: { type: "default" },
    language_code: "uk",
  };
  const base = env.API_BASE_URL || "https://api.telegram.org";
  const url = `${base}/bot${env.BOT_TOKEN}/setMyCommands`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return json({ ok: res.ok, status: res.status, data });
}

/* --------------------------- Exported Worker ------------------------- */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;

    // Health
    if (req.method === "GET" && pathname === "/health") {
      return json({ ok: true, ts: Date.now() });
    }

    // Webhook
    if (req.method === "POST" && pathname === WEBHOOK_PATH) {
      try {
        return await handleWebhook(env, req);
      } catch (e) {
        console.error("webhook error:", e);
        return new Response("OK");
      }
    }

    // Admin: меню команд
    if (req.method === "GET" && pathname === "/admin/set-commands") {
      try {
        return await registerBotCommands(env);
      } catch (e) {
        console.error("set-commands error:", e);
        return json({ ok: false, error: String(e) }, { status: 500 });
      }
    }

    if (req.method !== "GET" && req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;