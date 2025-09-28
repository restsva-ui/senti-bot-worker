// src/index.ts
/* --------------------------- Env & Imports --------------------------- */
export type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string; // e.g. https://api.telegram.org  (optional)
};

import { sendMessage } from "./utils/telegram";
import { cmdWiki } from "./commands/wiki";

/* --------------------------- Constants -------------------------------- */
const WEBHOOK_PATH = "/webhook/senti1984";

/* --------------------------- Types ----------------------------------- */
type TgUser = { language_code?: string };
type TgChat = { id: number };
type TgMessage = { text?: string; chat: TgChat; from?: TgUser };
type TgUpdate =
  | { message?: TgMessage } // ми працюємо з message; інші типи ігноруємо
  ;

/* --------------------------- Small utils ----------------------------- */
function parseJson<T = unknown>(req: Request): Promise<T> {
  return req.json() as Promise<T>;
}

// більш лояльний матчинг: допускаємо пробіли/переноси до і після,
// суфікс @botname, кінець рядка або пробіл після команди
function isCommand(msg: TgMessage | undefined, name: string): boolean {
  const t = (msg?.text ?? "").trim();              // обрізаємо «дивні» пробіли/переноси
  if (!t.startsWith("/")) return false;
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

/* --------------------------- Router (webhook) ------------------------ */
async function handleWebhook(env: Env, req: Request): Promise<Response> {
  const update = await parseJson<TgUpdate>(req);
  console.log("[webhook] raw update:", JSON.stringify(update));

  const msg = update.message;
  const txt = msg?.text ?? "";
  if (!msg) {
    console.log("[webhook] no message – ignore");
    return new Response("OK");
  }

  // командний роутер
  if (isCommand(msg, "start")) { await cmdStart(env, update); return new Response("OK"); }
  if (isCommand(msg, "ping"))  { await cmdPing(env, update);  return new Response("OK"); }
  if (isCommand(msg, "health")){ await cmdHealth(env, update);return new Response("OK"); }
  if (isCommand(msg, "help"))  { await cmdHelp(env, update);  return new Response("OK"); }
  if (isCommand(msg, "wiki"))  { await cmdWiki(env, update);  return new Response("OK"); }

  // Фолбек: якщо користувач натиснув меню і відправив порожній /wiki без аргументу,
  // cmdWiki сам поверне підказку. Якщо взагалі не команда — просто OK.
  console.log("[webhook] not a known command:", JSON.stringify({ text: txt }));
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
/** GET /admin/set-commands — реєстрація меню команд у Телеграмі */
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

    // 1) Healthcheck
    if (req.method === "GET" && pathname === "/health") {
      return json({ ok: true, ts: Date.now() });
    }

    // 2) Webhook
    if (req.method === "POST" && pathname === WEBHOOK_PATH) {
      try {
        return await handleWebhook(env, req);
      } catch (e) {
        console.error("webhook error:", e);
        return new Response("OK");
      }
    }

    // 3) Admin: зареєструвати меню команд
    if (req.method === "GET" && pathname === "/admin/set-commands") {
      try {
        return await registerBotCommands(env);
      } catch (e) {
        console.error("set-commands error:", e);
        return json({ ok: false, error: String(e) }, { status: 500 });
      }
    }

    // 4) Метод не дозволений / або шлях не знайдено
    if (req.method !== "GET" && req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;