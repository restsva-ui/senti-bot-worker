// src/index.ts
import { routeUpdate } from "./router";
import type { Update } from "./telegram/types";
import { CFG } from "./config";
import { sendMessage } from "./telegram/api";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 1) Проста перевірка живості воркера
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("OK", { status: 200 });
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response("healthy", { status: 200 });
    }

    // 2) Вебхук: /webhook/<secret>
    if (
      request.method === "POST" &&
      url.pathname === `/webhook/${CFG.webhookSecret}`
    ) {
      let update: Update | null = null;
      try {
        update = (await request.json()) as Update;

        // 🔎 ДІАГНОСТИКА: надсилаємо коротке службове повідомлення власнику
        // щоб підтвердити, що апдейт реально доставлено у воркер.
        const kind = update.callback_query
          ? "callback_query"
          : update.message
          ? "message"
          : "other";
        await sendMessage(
          Number(CFG.ownerId),
          `🔎 webhook: отримав ${kind} (update_id: ${"update_id" in update ? (update as any).update_id : "?"})`
        );

        // Маршрутизація
        await routeUpdate(update);
      } catch (e) {
        // Якщо парсинг або обробка впали — теж скажемо власнику
        try {
          await sendMessage(
            Number(CFG.ownerId),
            `⚠️ webhook error: ${(e as Error).message || e}`
          );
        } catch {
          // ignore
        }
      }
      // Відповідаємо Telegram якнайшвидше
      return new Response("OK", { status: 200 });
    }

    // 3) Не знайдено
    return new Response("Not found", { status: 404 });
  },
};