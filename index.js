// index.js — Senti Telegram Worker (stable)
// ENV required: TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET
// Optional: set your bot username to reduce extra calls (not required)

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

/** Safe JSON stringify */
function j(obj) {
  return JSON.stringify(obj);
}

/** Telegram API helper */
async function tg(method, params, token) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: j(params ?? {}),
  });
  // Do not throw on non-200 to avoid retries storms — return parsed result
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = { ok: false, description: "non-json response", status: res.status };
  }
  return { status: res.status, data };
}

/** Minimal router */
function route(req) {
  const u = new URL(req.url);
  return { path: u.pathname, search: u.searchParams };
}

/** Redact token preview */
function redact(s) {
  if (!s) return "";
  if (s.length <= 10) return "***";
  return s.slice(0, 4) + "…" + s.slice(-4);
}

/** Main handler */
export default {
  async fetch(request, env, ctx) {
    try {
      const { path, search } = route(request);

      // Health & info
      if (request.method === "GET" && (path === "/" || path === "/health")) {
        const info = {
          name: "senti-bot-worker",
          ok: true,
          time: new Date().toISOString(),
          routes: ["/", "/health", "POST /webhook"],
          env: {
            TELEGRAM_BOT_TOKEN: Boolean(env.TELEGRAM_BOT_TOKEN),
            WEBHOOK_SECRET: Boolean(env.WEBHOOK_SECRET),
          },
          previews: {
            TELEGRAM_BOT_TOKEN: redact(env.TELEGRAM_BOT_TOKEN ?? ""),
          },
          note: "Use POST /webhook with X-Telegram-Bot-Api-Secret-Token header.",
        };
        return new Response(j(info), { status: 200, headers: JSON_HEADERS });
      }

      // Optional: manual ping to yourself as a quick check (no auth)
      if (request.method === "GET" && path === "/ping") {
        return new Response("pong", { status: 200 });
      }

      // Telegram webhook endpoint
      if (request.method === "POST" && path === "/webhook") {
        // 1) Secret verification
        const sent = request.headers.get("x-telegram-bot-api-secret-token");
        if (!sent || sent !== env.WEBHOOK_SECRET) {
          return new Response("Forbidden", { status: 403 });
        }

        // 2) Parse update (ignore empty/invalid bodies safely)
        let update = {};
        try {
          update = await request.json();
        } catch (_) {
          // If Telegram ever sends empty body (shouldn't), just ack 200 to avoid retries
          return new Response("ok", { status: 200 });
        }

        // 3) Handle message
        const msg = update.message || update.edited_message || null;
        if (msg && msg.chat && typeof msg.chat.id !== "undefined") {
          const chatId = msg.chat.id;
          const text = (msg.text || "").trim();

          // Simple router: /start and echo
          if (text === "/start") {
            await tg(
              "sendMessage",
              {
                chat_id: chatId,
                text:
                  "Привіт! Я Senti Worker. Бот підключений і працює ✅\n" +
                  "Надішли будь-який текст — я пришлю ехо-відповідь.",
              },
              env.TELEGRAM_BOT_TOKEN
            );
          } else if (text) {
            await tg(
              "sendMessage",
              { chat_id: chatId, text: `echo: ${text}` },
              env.TELEGRAM_BOT_TOKEN
            );
          }
        }

        // 4) Always acknowledge Telegram immediately
        return new Response("ok", { status: 200 });
      }

      // Method not allowed on webhook
      if (path === "/webhook") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      // Fallback
      return new Response(
        j({ ok: true, message: "Senti Worker online", path }),
        { status: 200, headers: JSON_HEADERS }
      );
    } catch (err) {
      // Robust error guard: never leak secrets
      console.error("Worker error:", err && err.stack ? err.stack : err);
      return new Response(
        j({ ok: false, error: "internal_error" }),
        { status: 500, headers: JSON_HEADERS }
      );
    }
  },
};