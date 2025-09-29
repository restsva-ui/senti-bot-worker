// src/index.ts
import type { TgUpdate } from "./types";
import { commandRouter as routeUpdate } from "./router/commandRouter";

type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
  WEBHOOK_SECRET?: string; // додали: читаємо із секретів воркера
};

function ok(text = "OK", status = 200) {
  return new Response(text, { status, headers: { "content-type": "text/plain" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Простий healthcheck
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return ok("OK");
    }

    // Вебхук приймаємо лише тут
    if (url.pathname === "/webhook") {
      if (request.method !== "POST") return ok("OK");

      // 1) Перевірка секрету (якщо заданий)
      const hdr = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
      if (env.WEBHOOK_SECRET && hdr !== env.WEBHOOK_SECRET) {
        console.warn("Webhook secret mismatch");
        return new Response("unauthorized", { status: 401 });
      }

      // 2) Парсимо JSON (безпечний парс)
      let update: TgUpdate | undefined;
      try {
        update = (await request.json()) as TgUpdate;
      } catch (e) {
        console.error("Bad JSON", e);
        return ok("IGNORED"); // не шлемо 4xx, щоб TG не ретраїв
      }

      // 3) Діагностика: лог
      try {
        console.log("update:", JSON.stringify(update));
      } catch {}

      // 4) Аварійний хендлер: прямий /ping без реєстру (щоб зняти питання тиші)
      const text = update?.message?.text ?? update?.edited_message?.text ?? "";
      if (text?.trim().startsWith("/ping")) {
        await fetch(`${env.API_BASE_URL || "https://api.telegram.org"}/bot${env.BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: update?.message?.chat?.id, text: "pong ✅" }),
        }).catch((e) => console.error("sendMessage(ping) error", e));
        return ok();
      }

      // 5) Основний роутер команд / callback-и
      try {
        await routeUpdate(env as any, update!);
      } catch (e) {
        console.error("routeUpdate error:", e);
      }

      // Завжди 200, інакше Telegram буде ретраїти.
      return ok();
    }

    // Інші роути
    return new Response("Not Found", { status: 404 });
  },
};