export interface Env {
  // зручно мати кілька назв — візьмемо перший наявний
  BOT_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TG_BOT_TOKEN?: string;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getToken(env: Env): string | undefined {
  return env.BOT_TOKEN || env.TELEGRAM_BOT_TOKEN || env.TG_BOT_TOKEN;
}

async function tgSendMessage(token: string, chatId: number, text: string) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  // навіть якщо Telegram відповів помилкою — ми не валимо воркер
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    console.log("[tg] sendMessage failed", r.status, body);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // 1) health-check
    if (url.pathname === "/health") {
      return json({ ok: true, ts: Date.now() });
    }

    // 2) telegram webhook
    if (url.pathname.startsWith("/webhook/")) {
      if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

      const update = await req.json().catch(() => null);
      console.log("[webhook] raw update:", JSON.stringify(update));

      // безпечний парсинг
      const msg = update?.message;
      const text: string | undefined = msg?.text;
      const chatId: number | undefined = msg?.chat?.id;

      // якщо це команда — відповідаємо
      if (text && chatId) {
        const token = getToken(env);
        if (!token) {
          console.log("[webhook] BOT_TOKEN is missing, skip reply");
          return json({ ok: true }); // все одно 200 для TG
        }

        if (text.startsWith("/ping")) {
          await tgSendMessage(token, chatId, "pong ✅");
        } else if (text.startsWith("/start")) {
          await tgSendMessage(token, chatId, "✅ Senti онлайн\nНадішли /ping щоб перевірити відповідь.");
        }
      }

      return json({ ok: true });
    }

    // 3) все інше
    return new Response("Not found", { status: 404 });
  },
};