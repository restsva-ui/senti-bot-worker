export interface Env {
  // секрет із токеном бота (достатньо одного з трьох)
  BOT_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TG_BOT_TOKEN?: string;

  // необов'язковий override для базового URL Telegram API (у тебе є API_BASE_URL=https://api.telegram.org)
  API_BASE_URL?: string;
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

function getTelegramBase(env: Env): string {
  // дозволяємо підміняти базу через змінну (напр. через Cloudflare AI Gateway або проксі)
  return (env.API_BASE_URL || "https://api.telegram.org").replace(/\/+$/, "");
}

async function tgSendMessage(env: Env, chatId: number, text: string) {
  const token = getToken(env);
  if (!token) {
    console.log("[tg] missing BOT_TOKEN, skip reply");
    return;
  }
  const base = getTelegramBase(env);
  const url = `${base}/bot${token}/sendMessage`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    console.log("[tg] sendMessage failed", r.status, body);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // 1) health-check HTTP
    if (url.pathname === "/health") {
      return json({ ok: true, ts: Date.now() });
    }

    // 2) Telegram webhook
    if (url.pathname.startsWith("/webhook/")) {
      if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

      const update = await req.json().catch(() => null);
      console.log("[webhook] raw update:", JSON.stringify(update));

      const msg = update?.message;
      const text: string | undefined = msg?.text;
      const chatId: number | undefined = msg?.chat?.id;

      if (text && chatId) {
        if (text.startsWith("/ping")) {
          await tgSendMessage(env, chatId, "pong ✅");
        } else if (text.startsWith("/start")) {
          await tgSendMessage(env, chatId, "✅ Senti онлайн\nНадішли /ping щоб перевірити відповідь.");
        } else if (text.startsWith("/health")) {
          await tgSendMessage(env, chatId, "ok ✅");
        }
      }

      // Telegram завжди очікує 200
      return json({ ok: true });
    }

    // 3) інші роуты
    return new Response("Not found", { status: 404 });
  },
};