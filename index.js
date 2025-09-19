// Senti Telegram Bot on Cloudflare Workers (stable)

const TG_API = (token, method, params) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

const aiRun = async (accountId, apiToken, model, payload) => {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.log("AI error:", res.status, j);
    throw new Error(`AI ${res.status}`);
  }
  return j.result?.response ?? j.result ?? j;
};

export default {
  async fetch(req, env, ctx) {
    try {
      const { TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET, CLOUDFLARE_API_TOKEN, CF_ACCOUNT_ID } = env;
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/") {
        return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
      }

      if (req.method === "POST" && url.pathname === "/webhook") {
        const sec = req.headers.get("x-telegram-bot-api-secret-token");
        if (!WEBHOOK_SECRET || sec !== WEBHOOK_SECRET) {
          console.log("403 secret mismatch | got:", sec, "| need:", WEBHOOK_SECRET ? "***" : "(empty)");
          return new Response("Forbidden", { status: 403 });
        }

        let update;
        try {
          update = await req.json();
        } catch (e) {
          console.log("Bad JSON:", e?.message);
          return new Response("Bad Request", { status: 400 });
        }

        const msg = update.message || update.edited_message || update.callback_query?.message;
        const chatId = msg?.chat?.id;
        const text = msg?.text?.trim() ?? "";

        if (!TELEGRAM_BOT_TOKEN || !chatId) {
          console.log("Missing token or chatId", { haveToken: !!TELEGRAM_BOT_TOKEN, chatId });
          return new Response("OK", { status: 200 });
        }

        // Команди
        if (text === "/start") {
          await TG_API(TELEGRAM_BOT_TOKEN, "sendMessage", {
            chat_id: chatId,
            text: "Привіт! Я Senti. Напиши питання — відповім і, за потреби, підключу Workers AI.",
          });
          return new Response("OK", { status: 200 });
        }

        // Діалог з AI (простий режим)
        let reply = "Зрозумів. Працюю…";
        try {
          if (!CLOUDFLARE_API_TOKEN || !CF_ACCOUNT_ID) throw new Error("No AI creds");
          const model = "@cf/meta/llama-3.1-8b-instruct";
          const out = await aiRun(CF_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, model, {
            prompt: `Відповідай стисло українською. Запит: ${text || "(порожньо)"}`,
          });
          reply = typeof out === "string" ? out : (out?.output_text ?? JSON.stringify(out));
        } catch (e) {
          console.log("AI fallback:", e?.message);
          reply = "Не вдалось звернутись до Workers AI. Відповім як є.";
        }

        // Відправляємо відповідь
        await TG_API(TELEGRAM_BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          text: reply,
        });

        return new Response("OK", { status: 200 });
      }

      return new Response("Not Found", { status: 404 });
    } catch (e) {
      console.log("Unhandled error:", e?.stack || e?.message || String(e));
      return new Response("Internal Error", { status: 500 });
    }
  },
};