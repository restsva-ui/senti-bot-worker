// Вхідна точка воркера: перевірка секрету, аварійний /ping, делегування в commandRouter

import { commandRouter } from "./router/commandRouter";
import type { TgUpdate } from "./types";

type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
  WEBHOOK_SECRET?: string;
  LIKES_KV?: any;
};

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function tgCall(
  env: Env,
  method: string,
  payload: Record<string, unknown>
) {
  const api = env.API_BASE_URL || "https://api.telegram.org";
  const url = `${api}/bot${env.BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  // не валимо воркер, просто залогуємо
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("tgCall error", method, res.status, t);
  }
  return res.json().catch(() => ({}));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Проста перевірка живості через браузер
    if (request.method === "GET") {
      if (url.pathname === "/") return new Response("OK");
      if (url.pathname === "/ping") return new Response("pong");
      return new Response("Not Found", { status: 404 });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Перевірка секрету вебхука (якщо задано у воркері)
    const headerSecret = request.headers.get("x-telegram-bot-api-secret-token");
    if (env.WEBHOOK_SECRET && headerSecret !== env.WEBHOOK_SECRET) {
      console.warn("Webhook secret mismatch");
      return new Response("UNAUTHORIZED", { status: 401 });
    }

    // Парсимо апдейт
    let update: TgUpdate;
    try {
      update = (await request.json()) as TgUpdate;
    } catch (e) {
      console.error("Bad JSON", String(e));
      return new Response("BAD_REQUEST", { status: 400 });
    }

    // Аварійна команда /ping, навіть якщо registry зламається
    const text =
      update.message?.text ??
      update.edited_message?.text ??
      update.message?.caption ??
      update.edited_message?.caption ??
      "";
    if (typeof text === "string" && text.trim().startsWith("/ping")) {
      const chatId =
        update.message?.chat?.id ?? update.edited_message?.chat?.id;
      if (chatId) {
        await tgCall(env, "sendMessage", { chat_id: chatId, text: "pong ✅" });
      }
      return jsonResponse({ ok: true });
    }

    // Делегуємо у роутер команд (підтримує і message, і callback_query)
    try {
      const resp = await commandRouter(env as any, update);
      // commandRouter завжди повертає Response
      return resp ?? new Response("OK");
    } catch (e) {
      console.error("commandRouter crashed:", e);
      // повідомимо власнику (не блокує відповідь)
      try {
        if (env.BOT_TOKEN && (env as any).OWNER_ID) {
          await tgCall(env, "sendMessage", {
            chat_id: (env as any).OWNER_ID,
            text: `⚠️ Router error: ${String(e)}`,
          });
        }
      } catch {}
      return new Response("OK");
    }
  },
};