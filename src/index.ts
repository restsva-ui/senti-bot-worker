// Cloudflare Worker entry — лише маршрутизація + командний роутер.

import { tgSend, parseUpdate, md, trimCommand } from "./tg";
import { wikiSummary } from "./wiki";
import { nbuRate } from "./rate";
import { weatherNow } from "./weather";

export interface Env {
  TELEGRAM_TOKEN: string;          // обовʼязково (твій бот-токен)
  WEBHOOK_SECRET?: string;         // секретна частина шляху вебхука
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // 1) HEALTH
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return json({ ok: true, ts: Date.now() });
    }

    // 2) TELEGRAM WEBHOOK: /webhook/<secret>
    const secret = env.WEBHOOK_SECRET || "senti1984";
    if (url.pathname === `/webhook/${secret}` && req.method === "POST") {
      const update = await req.json<any>().catch(() => null);
      if (!update) return json({ ok: false, error: "bad json" }, 400);

      // лог-сирий апдейт (Cloudflare Logs)
      console.log("[webhook] raw update:", JSON.stringify(update, null, 2));

      const parsed = parseUpdate(update);
      if (!parsed) return json({ ok: true }); // нічого відповідати

      const { chatId, text } = parsed;
      const token = env.TELEGRAM_TOKEN;
      if (!token) return json({ ok: false, error: "no token" }, 500);

      // --- командний роутер ---
      try {
        if (text === "/start") {
          await tgSend(token, chatId,
            md`✅ *Senti онлайн*  
Надішли \`/ping\` щоб перевірити відповідь.  
Корисне: \`/wiki Київ\`, \`/rate\`, \`/weather Lviv\``,
            "Markdown");
          return json({ ok: true });
        }

        if (text === "/ping") {
          await tgSend(token, chatId, "pong ✅");
          return json({ ok: true });
        }

        if (text.startsWith("/wiki")) {
          const q = trimCommand(text, "/wiki");
          if (!q) {
            await tgSend(token, chatId, "Синтаксис: /wiki <запит>");
            return json({ ok: true });
          }
          const ans =
            await wikiSummary(q, "uk").catch(() => wikiSummary(q, "en"));
          await tgSend(token, chatId, ans, "Markdown");
          return json({ ok: true });
        }

        if (text === "/rate") {
          const ans = await nbuRate();
          await tgSend(token, chatId, ans, "Markdown");
          return json({ ok: true });
        }

        if (text.startsWith("/weather")) {
          const q = trimCommand(text, "/weather");
          if (!q) {
            await tgSend(token, chatId, "Синтаксис: /weather <місто|країна>");
            return json({ ok: true });
          }
          const ans = await weatherNow(q);
          await tgSend(token, chatId, ans);
          return json({ ok: true });
        }

        // Unknown command -> ігноруємо тихо
        return json({ ok: true });
      } catch (e: any) {
        console.error("handler error:", e);
        await tgSend(token, chatId, "Помилка обробки запиту 😔");
        return json({ ok: true });
      }
    }

    // 3) Fallback
    return new Response("Not found", { status: 404 });
  },
};