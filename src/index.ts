// src/index.ts
/* --------------------------- Env & Imports --------------------------- */
export type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
  ADMIN_CHAT_ID?: string; // опціонально: 784869835
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
function getAdminId(env: Env): number | null {
  if (!env.ADMIN_CHAT_ID) return null;
  const n = Number(env.ADMIN_CHAT_ID);
  return Number.isFinite(n) ? n : null;
}
function pickChatId(url: URL, env: Env): number | null {
  // ?chat_id= / ?id= / /admin/test-help/:id
  const qsId = url.searchParams.get("chat_id") ?? url.searchParams.get("id");
  if (qsId && /^\d+$/.test(qsId)) return Number(qsId);
  const parts = url.pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (last && /^\d+$/.test(last)) return Number(last);
  const admin = getAdminId(env);
  return admin;
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

/* --------------------------- Webhook logic --------------------------- */
async function handleWebhook(env: Env, req: Request): Promise<Response> {
  const update = await parseJson<TgUpdate>(req);
  console.log("[webhook] raw update:", JSON.stringify(update));

  const msg = update.message;
  if (isCommand(msg, "start")) { await cmdStart(env, update); return new Response("OK"); }
  if (isCommand(msg, "ping"))  { await cmdPing(env, update);  return new Response("OK"); }
  if (isCommand(msg, "health")){ await cmdHealth(env, update);return new Response("OK"); }
  if (isCommand(msg, "help"))  { await cmdHelp(env, update);  return new Response("OK"); }
  if (isCommand(msg, "wiki"))  { await cmdWiki(env, update);  return new Response("OK"); }

  return new Response("OK");
}

/* --------------------------- Exported Worker ------------------------- */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // 1) Healthcheck
    if (req.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, ts: Date.now() });
    }

    // 2) Test admin: send help to chat
    if (req.method === "GET" && url.pathname.startsWith("/admin/test-help")) {
      const chatId = pickChatId(url, env);
      if (!chatId) return json({ ok: false, error: "no chat id" }, { status: 400 });

      // м'який гард: якщо ADMIN_CHAT_ID задано і відрізняється — помилка
      const admin = getAdminId(env);
      if (admin && chatId !== admin) {
        return json({ ok: false, error: "admin error" }, { status: 403 });
      }

      await sendMessage(env, chatId, helpText());
      return json({ ok: true, status: 200, sent: "help", chat_id: chatId });
    }

    // 3) Test admin: wiki via HTTP
    if (req.method === "GET" && url.pathname.startsWith("/admin/test-wiki")) {
      const chatId = pickChatId(url, env);
      const q = url.searchParams.get("q") ?? "";
      if (!chatId) return json({ ok: false, error: "no chat id" }, { status: 400 });
      if (!q.trim()) return json({ ok: false, error: "no query" }, { status: 400 });

      const admin = getAdminId(env);
      if (admin && chatId !== admin) {
        return json({ ok: false, error: "admin error" }, { status: 403 });
      }

      // зімітуємо апдейт: "/wiki <q>"
      const fakeUpdate: TgUpdate = { message: { chat: { id: chatId }, text: `/wiki ${q}` } };
      await cmdWiki(env, fakeUpdate);
      return json({ ok: true, status: 200, sent: "wiki", q, chat_id: chatId });
    }

    // 4) Webhook
    if (req.method === "POST" && url.pathname === WEBHOOK_PATH) {
      try {
        return await handleWebhook(env, req);
      } catch (e) {
        console.error("webhook error:", e);
        return new Response("OK");
      }
    }

    // 5) Інші методи/шляхи
    if (req.method !== "GET" && req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;