// src/index.ts
/* --------------------------- Env & Imports --------------------------- */
export type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string; // опційно, за замовч. https://api.telegram.org
};

import { sendMessage } from "./utils/telegram";
import { cmdWiki } from "./commands/wiki";

/* --------------------------- Constants ------------------------------- */
const WEBHOOK_PATH = "/webhook/senti1984";
const TG_API_DEFAULT = "https://api.telegram.org";

/* --------------------------- Types ----------------------------------- */
type TgUser = { id?: number; language_code?: string };
type TgChat = { id: number };
type TgMessage = { message_id?: number; text?: string; chat: TgChat; from?: TgUser };
type TgUpdate = { update_id?: number; message?: TgMessage };

/* --------------------------- Small utils ----------------------------- */
function parseJson<T = unknown>(req: Request): Promise<T> {
  return req.json() as Promise<T>;
}

function norm(s?: string) {
  return (s ?? "").trim();
}

function isCommand(msg?: TgMessage, name?: string) {
  const t = norm(msg?.text);
  if (!name || !t.startsWith("/")) return false;
  // Надійний RegExp + додатковий захист на випадок /help@bot або /help\n
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

/* --------------------------- Minimal TG API -------------------------- */
// Локальний тонкий клієнт, щоб не тягнути зайві імпорти для службових ендпоїнтів
async function tgApi(env: Env, method: string, payload: Record<string, unknown>) {
  const base = env.API_BASE_URL || TG_API_DEFAULT;
  const url = `${base}/bot${env.BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
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

/* --------------------------- Router: Webhook ------------------------- */
async function handleWebhook(env: Env, req: Request): Promise<Response> {
  const update = await parseJson<TgUpdate>(req);
  console.log("[webhook] raw update:", JSON.stringify(update));

  const msg = update.message;
  const text = norm(msg?.text);
  const chatId = msg?.chat.id;

  try {
    if (!msg || !chatId) {
      console.log("[webhook] no message/chat in update");
      return new Response("OK"); // Нічого відповідати
    }

    // Порядок важливий
    if (isCommand(msg, "start")) {
      console.log("[webhook] /start");
      await cmdStart(env, update);
      return new Response("OK");
    }

    if (isCommand(msg, "ping")) {
      console.log("[webhook] /ping");
      await cmdPing(env, update);
      return new Response("OK");
    }

    if (isCommand(msg, "health")) {
      console.log("[webhook] /health");
      await cmdHealth(env, update);
      return new Response("OK");
    }

    if (isCommand(msg, "help") || /^\/help\b/i.test(text)) {
      // Додаткове резервне правило — навіть якщо в тексті дивні символи після /help
      console.log("[webhook] /help");
      await cmdHelp(env, update);
      return new Response("OK");
    }

    if (isCommand(msg, "wiki")) {
      console.log("[webhook] /wiki");
      await cmdWiki(env, update);
      return new Response("OK");
    }

    // Фолбек: якщо користувач натиснув “Wiki (UA)” і прислав лише "/wiki"
    if (/^\/wiki(?:@\w+)?\s*$/i.test(text)) {
      console.log("[webhook] /wiki (no args) -> usage");
      await sendMessage(env, chatId, "Використання: /wiki <запит>\nНапр.: /wiki Київ");
      return new Response("OK");
    }

    // Інше — ігноруємо, але логуємо
    console.log("[webhook] no command matched:", text);
    return new Response("OK");
  } catch (e) {
    console.error("[webhook] handler error:", e);
    return new Response("OK");
  }
}

/* --------------------------- Admin endpoints ------------------------- */
async function handleAdmin(env: Env, url: URL): Promise<Response> {
  // /admin/set-commands  — зареєструвати команди
  if (url.pathname === "/admin/set-commands") {
    const commands = [
      { command: "start",  description: "Запуск і вітання" },
      { command: "ping",   description: "Перевірка звʼязку (pong)" },
      { command: "health", description: "Перевірка стану" },
      { command: "help",   description: "Список команд" },
      { command: "wiki",   description: "Довідка з Вікіпедії" },
    ];
    const result = await tgApi(env, "setMyCommands", {
      commands,
      language_code: "uk",
      scope: { type: "default" },
    });
    console.log("[admin] setMyCommands:", result);
    return json({ ok: true, ...result });
  }

  // /admin/test-help — перевірка відповіді help в тестовому чаті (потрібен ?chat_id=)
  if (url.pathname === "/admin/test-help") {
    const chatId = Number(url.searchParams.get("chat_id"));
    if (!chatId) return json({ ok: false, error: "chat_id required" }, { status: 400 });
    await sendMessage(env, chatId, helpText());
    return json({ ok: true });
  }

  return new Response("Not found", { status: 404 });
}

/* --------------------------- Exported Worker ------------------------- */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // 1) Healthcheck (GET)
    if (req.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, ts: Date.now() });
    }

    // 2) Admin (GET)
    if (req.method === "GET" && url.pathname.startsWith("/admin/")) {
      try {
        return await handleAdmin(env, url);
      } catch (e) {
        console.error("[admin] error:", e);
        return json({ ok: false, error: "admin error" }, { status: 500 });
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