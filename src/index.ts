// src/index.ts

/* --------------------------- Env & Imports --------------------------- */
export type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
  ADMIN_CHAT_ID?: string; // опційно: для /admin/test-help без параметрів
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

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
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

/* --------------------------- Webhook handler ------------------------- */
async function handleWebhook(env: Env, req: Request): Promise<Response> {
  const update = await parseJson<TgUpdate>(req);
  console.log("[webhook] raw update:", JSON.stringify(update));

  const msg = update.message;

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
  if (isCommand(msg, "help")) {
    await cmdHelp(env, update);
    return new Response("OK");
  }
  if (isCommand(msg, "wiki")) {
    await cmdWiki(env, update);
    return new Response("OK");
  }

  return new Response("OK");
}

/* --------------------------- Exported Worker ------------------------- */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(req.url);

      // 1) Healthcheck (GET)
      if (req.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, ts: Date.now() });
      }

      // 2) Admin: тест відправки help у чат
      //    /admin/test-help?chat_id=123
      if (req.method === "GET" && url.pathname === "/admin/test-help") {
        try {
          const chatIdStr =
            url.searchParams.get("chat_id") ?? env.ADMIN_CHAT_ID ?? "";
          const chatId = Number(chatIdStr);

          if (!Number.isFinite(chatId)) {
            return json({ ok: false, error: "admin error" });
          }

          await sendMessage(env, chatId, helpText());
          return json({ ok: true, status: 200, sent: "help" });
        } catch (e) {
          console.error("admin/test-help error:", e);
          return json({ ok: false, error: "exception" });
        }
      }

      // 3) Admin: тест wiki-команди через HTTP
      //    /admin/test-wiki?q=Київ&chat_id=123
      if (req.method === "GET" && url.pathname === "/admin/test-wiki") {
        try {
          const q = url.searchParams.get("q") ?? "Київ";
          const chatIdStr =
            url.searchParams.get("chat_id") ?? env.ADMIN_CHAT_ID ?? "";
          const chatId = Number(chatIdStr);

          if (!Number.isFinite(chatId)) {
            return json({ ok: false, error: "admin error" });
          }

          // надсилаємо у чат «/wiki <q>»
          await sendMessage(env, chatId, `/wiki ${q}`);
          return json({ ok: true, status: 200, sent: "wiki", q });
        } catch (e) {
          console.error("admin/test-wiki error:", e);
          return json({ ok: false, error: "exception" });
        }
      }

      // 4) Webhook (POST)
      if (req.method === "POST" && url.pathname === WEBHOOK_PATH) {
        try {
          return await handleWebhook(env, req);
        } catch (e) {
          console.error("webhook error:", e);
          // не валимо воркер — Telegram не потрібна детальна відповідь
          return new Response("OK");
        }
      }

      // 5) Інші методи/шляхи
      if (req.method !== "GET" && req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }
      return new Response("Not found", { status: 404 });
    } catch (e) {
      // глобальна страховка, щоб не ловити 1101
      console.error("fatal fetch error:", e);
      return json({ ok: false, error: "fatal" }, { status: 200 });
    }
  },
} satisfies ExportedHandler<Env>;
```0