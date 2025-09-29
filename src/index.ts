// src/index.ts
import type { TgUpdate } from "./types";
import { commandRouter as routeUpdate } from "./router/commandRouter";

type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
  WEBHOOK_SECRET?: string;        // опціонально: якщо ставиш секрет у вебхуку
  LIKES_KV?: KVNamespace;
  OWNER_ID?: string;
};

function ok(text = "OK", code = 200) {
  return new Response(text, { status: code });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      // Проста перевірка здоров'я
      if (req.method === "GET") return ok("ok ✅");

      // Приймаємо POST з будь-якого шляху (/ або /webhook — неважливо)
      if (req.method !== "POST") return ok("method not allowed", 405);

      // Валідація секрету (якщо використовуєш secret_token у setWebhook)
      const secret = env.WEBHOOK_SECRET;
      if (secret) {
        const got = req.headers.get("x-telegram-bot-api-secret-token");
        if (got !== secret) return ok("forbidden", 403);
      }

      const update = (await req.json()) as TgUpdate;

      // Гарт: жодних падінь назовні — завжди 200
      try {
        await routeUpdate(env as any, update);
      } catch (e) {
        console.error("[routeUpdate error]", e);
      }

      return ok();
    } catch (e) {
      console.error("[fetch error]", e);
      // Telegram очікує 200, навіть якщо всередині помилка
      return ok();
    }
  },
} satisfies ExportedHandler<Env>;