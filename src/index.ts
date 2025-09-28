// src/index.ts
/* --------------------------- Env & Imports --------------------------- */
export type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string; // опційно, за замовчуванням api.telegram.org
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
const TG_DEFAULT_BASE = "https://api.telegram.org";

function parseJson<T = unknown>(req: Request): Promise<T> {
  return req.json() as Promise<T>;
}

function isCommand(msg?: TgMessage, name?: string) {
  const t = (msg?.text ?? "").trim();
  if (!name) return false;
  // /cmd або /cmd@botname + пробіл/кінець
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

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

function tgBase(env: Env) {
  return (env.API_BASE_URL || TG_DEFAULT_BASE).replace(/\/+$/, "");
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

/* --------------------------- Admin: setMyCommands -------------------- */
async function setMyCommands(env: Env) {
  const base = tgBase(env);
  const url = `${base}/bot${env.BOT_TOKEN}/setMyCommands`;
  const commands = [
    { command: "start", description: "запуск і вітання" },
    { command: "ping", description: "перевірка зв’язку" },
    { command: "health", description: "перевірка стану сервера" },
    { command: "help", description: "список команд" },
    { command: "wiki", description: "пошук у Вікіпедії" },
  ];
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ commands }),
  });
  const data = await r.json<any>();
  return { ok: r.ok, status: r.status, data };
}

/* --------------------------- Webhook router -------------------------- */
async function handleWebhook(env: Env, req: Request): Promise<Response> {
  const update = await parseJson<TgUpdate>(req);
  console.log("[webhook] raw update:", JSON.stringify(update));

  const msg = update.message;
  const text = (msg?.text ?? "").trim();

  try {
    if (isCommand(msg, "start")) {
      await cmdStart(env, update);
      return new Response("OK");
    }
    if (isCommand(msg, "ping")) {
      await cmdPing(env, update);
      return new Response("OK");
    }
    if (isCommand(msg, "health")) {
      await cmdHealth(env, update);
      return new Response("OK");
    }
    // Додаємо «страховку» для /help (деякі клієнти інколи не ставлять entity)
    if (isCommand(msg, "help") || /^\/help(\s|$)/i.test(text)) {
      await cmdHelp(env, update);
      return new Response("OK");
    }
    if (isCommand(msg, "wiki")) {
      await cmdWiki(env, update);
      return new Response("OK");
    }
  } catch (e) {
    console.error("webhook handler error:", e);
    // Не ламаємо deliver — завжди 200
    return new Response("OK");
  }

  // Невідома команда — тихий 200
  return new Response("OK");
}

/* --------------------------- Exported Worker ------------------------- */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // 1) Healthcheck (GET)
    if (req.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, ts: Date.now() });
    }

    // 2) Адмін-ендпойнт: зареєструвати меню команд у Телеграм
    //    Виклик: GET https://<worker>/admin/set-commands
    if (req.method === "GET" && url.pathname === "/admin/set-commands") {
      try {
        const res = await setMyCommands(env);
        console.log("[admin] setMyCommands:", res);
        return json(res);
      } catch (e) {
        console.error("[admin] setMyCommands error:", e);
        return json({ ok: false, error: String(e) }, { status: 500 });
      }
    }

    // 3) Webhook (POST)
    if (req.method === "POST" && url.pathname === WEBHOOK_PATH) {
      return await handleWebhook(env, req);
    }

    // 4) Інші методи/шляхи
    if (req.method !== "GET" && req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;