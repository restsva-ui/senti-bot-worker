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

async function tgTyping(apiBase, chatId) {
  try { await tg(apiBase, "sendChatAction", { chat_id: chatId, action: "typing" }); } catch (_) {}
}

function greet(name, lang) {
  const greetings = {
    uk: `Привіт, ${name || "друже"}! ✨ Давай зробимо світ трішки яскравішим!`,
    ru: `Привет, ${name || "друг"}! ✨ Давай сделаем этот мир ярче!`,
    en: `Hi, ${name || "friend"}! ✨ Let's make the world a bit brighter!`,
    de: `Hallo, ${name || "Freund"}! ✨ Lass uns die Welt etwas heller machen!`,
    fr: `Salut, ${name || "ami"}! ✨ Rendons le monde un peu plus lumineux!`,
  };
  return greetings[lang] || greetings.en;
}

function funReply(lang) {
  const extras = { uk: "🙂✨🎉", ru: "🔥😉🚀", en: "😎👍🔥", de: "🍻🇩🇪😁", fr: "🥖❤️🇫🇷" };
  return extras[lang] || "🤖";
}

// === KV helpers ===
async function kvGet(env, key) { return await env.AIMAGIC_SESS.get(key); }
async function kvPut(env, key, value, ttl = 1800) { return await env.AIMAGIC_SESS.put(key, value, { expirationTtl: ttl }); }
async function kvIncr(env, key) {
  // примітивний інкремент (read-modify-write); ок для малих навантажень
  const cur = parseInt((await kvGet(env, key)) || "0", 10) || 0;
  const next = cur + 1;
  await kvPut(env, key, String(next), 24 * 3600);
  return next;
}

// === LLM: Gemini ===
async function llmGemini(apiKey, userText, lang = "en") {
  const sys = `Відповідай мовою користувача (${lang}). Будь стислим і корисним. Якщо користувач просить код — додай короткі коментарі.`;
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

// === опційні медіа-вставки (стикер/гіф) кожне N-е повідомлення ===
function pickLangKey(lang) {
  const L = (lang || "en").toLowerCase();
  if (L.startsWith("uk")) return "UK";
  if (L.startsWith("ru")) return "RU";
  if (L.startsWith("de")) return "DE";
  if (L.startsWith("fr")) return "FR";
  return "EN";
}
async function maybeSendFlavorMedia(apiBase, env, chatId, lang, everyN = 4) {
  try {
    const n = await kvIncr(env, `cnt:${chatId}`);
    if (n % everyN !== 0) return;

    const key = pickLangKey(lang);
    // 1) gif (animation) через URL (змінні оточення опційні)
    const gif = env[`GIF_${key}`]; // напр., GIF_UK
    if (gif) {
      await tg(apiBase, "sendAnimation", { chat_id: chatId, animation: gif });
      return;
    }
    // 2) sticker через file_id (якщо попередньо зберіг у секретах)
    const st = env[`STICKER_${key}`]; // напр., STICKER_EN
    if (st) {
      await tg(apiBase, "sendSticker", { chat_id: chatId, sticker: st });
      return;
    }
    // 3) інакше — просто нічого не шлемо (емодзі вже є в тексті)
  } catch (_) {}
}

// === main worker ===
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") return ok("ok");

    const BOT_TOKEN = env.TELEGRAM_TOKEN;
    const WEBHOOK_SECRET = env.WEBHOOK_SECRET;
    if (!BOT_TOKEN) return bad(500, "TELEGRAM_TOKEN is missing");
    if (!WEBHOOK_SECRET) return bad(500, "WEBHOOK_SECRET is missing");
    const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

    // ручна установка вебхука
    if (request.method === "GET" && url.pathname === "/setwebhook") {
      if (url.searchParams.get("secret") !== WEBHOOK_SECRET) return bad(403, "forbidden");
      const hookUrl = `${url.origin}/webhook`;
      const res = await tg(API, "setWebhook", {
        url: hookUrl, secret_token: WEBHOOK_SECRET,
        allowed_updates: ["message"], max_connections: 40,
      });
      return json({ status: "ok", set_to: hookUrl, tg: res });
    }

    // Telegram webhook
    if (request.method === "POST" && url.pathname === "/webhook") {
      const got = request.headers.get("x-telegram-bot-api-secret-token");
      if (got !== WEBHOOK_SECRET) return bad(403, "forbidden");

      const update = await request.json().catch(() => null);
      if (!update) return bad(400, "no update");

      const msg = update.message;
      if (!msg) return ok();

      const chatId = msg.chat?.id;
      const textIn = (msg.text || "").trim();

      // зберігаємо мову
      if (msg.from?.language_code) {
        await kvPut(env, `lang:${chatId}`, msg.from.language_code, 3600);
      }
      let lang = await kvGet(env, `lang:${chatId}`);
      if (!lang) lang = msg.from?.language_code || "en";

      if (textIn === "/start") {
        const name = msg.from?.first_name || "";
        await tg(API, "sendMessage", { chat_id: chatId, text: greet(name, lang) });
        // можеш одразу на старті вистрілити gif/sticker (не обов'язково):
        await maybeSendFlavorMedia(API, env, chatId, lang, 1); // 1 = відразу
        return ok();
      }

      if (textIn === "/help") {
        const helps = {
          uk: "Команди:\n/start — вітання\n/help — допомога\nБудь-який текст — відповідь від Сенті (LLM).",
          ru: "Команды:\n/start — приветствие\n/help — помощь\nЛюбой текст — ответ от Сенти (LLM).",
          en: "Commands:\n/start — greeting\n/help — help\nAny text — answer from Senti (LLM).",
          de: "Befehle:\n/start — Begrüßung\n/help — Hilfe\nBeliebiger Text — Antwort von Senti (LLM).",
          fr: "Commandes:\n/start — salutation\n/help — aide\nTout texte — réponse de Senti (LLM).",
        };
        await tg(API, "sendMessage", { chat_id: chatId, text: helps[lang] || helps.en });
        return ok();
      }

      if (textIn) {
        // показуємо "typing…"
        await tgTyping(API, chatId);

        // кеш відповідей
        const cacheKey = `resp:${chatId}:${textIn}`;
        let reply = await kvGet(env, cacheKey);
        if (!reply) {
          try {
            if (env.GEMINI_API_KEY) {
              reply = await llmGemini(env.GEMINI_API_KEY, textIn, lang);
            } else {
              reply = textIn; // fallback
            }
            await kvPut(env, cacheKey, reply, 120); // 2 хв
          } catch (e) {
            reply = `AI error: ${e.message || e}`;
          }
        }

        const finalText = `${reply}\n\n${funReply(lang)}`;
        await tg(API, "sendMessage", { chat_id: chatId, text: finalText });

        // іноді додаємо стікер/гіф (кожне 4-те повідомлення)
        await maybeSendFlavorMedia(API, env, chatId, lang, 4);

        return ok();
      }

      return ok();
    }

    return bad(404, "not found");
  },
};
