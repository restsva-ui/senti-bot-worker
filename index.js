// === util responses ===
const json = (obj, init = {}) =>
  new Response(JSON.stringify(obj), { headers: { "content-type": "application/json;charset=utf-8" }, ...init });
const text = (body, init = {}) =>
  new Response(body, { headers: { "content-type": "text/plain" }, ...init });
const ok = (body = "ok") => text(body, { status: 200 });
const bad = (status = 400, msg = "bad request") => text(msg, { status });

// === telegram helpers ===
async function tg(apiBase, method, payload) {
  const r = await fetch(`${apiBase}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`TG ${method} ${r.status}: ${body}`);
  return JSON.parse(body || "{}");
}
function greet(name) { const who = name ? `, ${name}` : ""; return `Привіт${who}! ✨ Я вже чекав нашої зустрічі!`; }

// === KV helpers ===
async function kvGet(env, key) {
  return await env.AIMAGIC_SESS.get(key);
}
async function kvPut(env, key, value, ttl = 1800) {
  return await env.AIMAGIC_SESS.put(key, value, { expirationTtl: ttl });
}

// === LLM providers (мінімум Gemini як приклад) ===
async function llmGemini(apiKey, userText, sys = "Be helpful. Reply in user's language.") {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + apiKey;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { role: "system", parts: [{ text: sys }] },
      contents: [{ role: "user", parts: [{ text: userText }]}],
      generationConfig: { temperature: 0.5 },
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${JSON.stringify(data)}`);
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}

// === main worker ===
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // health
    if (request.method === "GET" && url.pathname === "/") return ok("ok");

    const BOT_TOKEN = env.TELEGRAM_TOKEN;
    const WEBHOOK_SECRET = env.WEBHOOK_SECRET;
    if (!BOT_TOKEN) return bad(500, "TELEGRAM_TOKEN is missing");
    if (!WEBHOOK_SECRET) return bad(500, "WEBHOOK_SECRET is missing");
    const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

    // manual webhook setter
    if (request.method === "GET" && url.pathname === "/setwebhook") {
      if (url.searchParams.get("secret") !== WEBHOOK_SECRET) return bad(403, "forbidden");
      const hookUrl = `${url.origin}/webhook`;
      const res = await tg(API, "setWebhook", {
        url: hookUrl, secret_token: WEBHOOK_SECRET,
        allowed_updates: ["message"], max_connections: 40,
      });
      return json({ status: "ok", set_to: hookUrl, tg: res });
    }

    // telegram webhook
    if (request.method === "POST" && url.pathname === "/webhook") {
      // header secret check
      const got = request.headers.get("x-telegram-bot-api-secret-token");
      if (got !== WEBHOOK_SECRET) return bad(403, "forbidden");

      const update = await request.json().catch(() => null);
      if (!update) return bad(400, "no update");

      const msg = update.message;
      if (!msg) return ok();

      const chatId = msg.chat?.id;
      const textIn = (msg.text || "").trim();

      // збережемо мову користувача
      if (msg.from?.language_code) {
        await kvPut(env, `lang:${chatId}`, msg.from.language_code, 3600);
      }

      if (textIn === "/start") {
        const name = msg.from?.first_name || "";
        await tg(API, "sendMessage", { chat_id: chatId, text: greet(name) });
        return ok();
      }
      if (textIn === "/help") {
        await tg(API, "sendMessage", {
          chat_id: chatId,
          text: "Команди:\n/start — вітання\n/help — допомога\nБудь-який текст — відповідь від Сенті (LLM)."
        });
        return ok();
      }

      if (textIn) {
        // спробуємо витягти з KV кешовану відповідь
        const cacheKey = `resp:${chatId}:${textIn}`;
        let reply = await kvGet(env, cacheKey);

        if (!reply) {
          try {
            if (env.GEMINI_API_KEY) {
              reply = await llmGemini(env.GEMINI_API_KEY, textIn);
            } else {
              reply = `Ехо: ${textIn}`;
            }
            // кешуємо на 2 хв
            await kvPut(env, cacheKey, reply, 120);
          } catch (e) {
            reply = `Помилка AI: ${e.message || e}`;
          }
        }

        await tg(API, "sendMessage", { chat_id: chatId, text: reply });
        return ok();
      }

      return ok();
    }

    return bad(404, "not found");
  },
};
