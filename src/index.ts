// src/index.ts
/* --------------------------- Env & Imports --------------------------- */
export type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
};

import { sendMessage } from "./utils/telegram";
import { cmdWiki } from "./commands/wiki";

/* --------------------------- Constants ------------------------------- */
const WEBHOOK_PATH = "/webhook/senti1984";

/* --------------------------- Types ----------------------------------- */
type TgUser = { language_code?: string };
type TgChat = { id: number };
type TgMessage = { text?: string; chat: TgChat; from?: TgUser };
type TgUpdate = { message?: TgMessage };

/* --------------------------- Small utils ----------------------------- */
function parseJson<T = unknown>(req: Request): Promise<T> {
  return req.json() as Promise<T>;
}

function isCommand(msg?: TgMessage, name?: string) {
  const t = msg?.text ?? "";
  if (!name) return false;
  const re = new RegExp(`^\\/${name}(?:@\\w+)?(?:\\s|$)`, "i");
  return re.test(t);
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

/* --------------------------- Command handlers ------------------------ */
async function cmdStart(env: Env, update: TgUpdate) {
  const chatId = update.message!.chat.id;
  await sendMessage(
    env,
    chatId,
    "✅ Senti онлайн\nНадішли /ping щоб перевірити відповідь."
  );
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

/* --------------------------- Router (HTTP) --------------------------- */
async function handleWebhook(env: Env, req: Request): Promise<Response> {
  const update = (await parseJson<TgUpdate>(req));
  console.log("[webhook] raw update:", JSON.stringify(update));

  const msg = update.message;

  if (isCommand(msg, "start")) { await cmdStart(env, update); return new Response("OK"); }
  if (isCommand(msg, "ping"))  { await cmdPing(env, update);  return new Response("OK"); }
  if (isCommand(msg, "health")){ await cmdHealth(env, update);return new Response("OK"); }
  if (isCommand(msg, "help"))  { await cmdHelp(env, update);  return new Response("OK"); }
  if (isCommand(msg, "wiki"))  { await cmdWiki(env, update);  return new Response("OK"); }

  return new Response("OK");
}

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

/* --------------------------- Exported Worker ------------------------- */
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