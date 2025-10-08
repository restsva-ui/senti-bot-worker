// src/lib/tg.js
// Надійні виклики Telegram API з автосплітом довгих повідомлень
// і явною обробкою помилок (щоб safe(...) міг показати ❌ у чаті).

const TG_API = "https://api.telegram.org";
const SAFE_TG_MSG_LEN = 3500; // запас до жорсткого ліміту ~4096

// Внутрішній хелпер виклику API з перевіркою res.ok
async function call(botToken, method, payload) {
  const res = await fetch(`${TG_API}/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  if (!res.ok) {
    // читаємо тіло, щоб побачити помилку Telegram
    let body = "";
    try { body = await res.text(); } catch {}
    throw new Error(`TG ${method} ${res.status}: ${body || "<empty>"}`);
  }
  return res;
}

// Розбиваємо довгі тексти на шматки ≤ SAFE_TG_MSG_LEN
function splitForTg(text, limit = SAFE_TG_MSG_LEN) {
  if (!text) return [""];
  if (text.length <= limit) return [text];

  const parts = [];
  let rest = text;

  while (rest.length > limit) {
    // намагаємось різати по переносу рядка або пробілу
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < 0) cut = rest.lastIndexOf(" ", limit);
    // якщо нормальної точки розрізу нема — просто ріжемо "в лоб"
    if (cut < 0 || cut < limit * 0.5) cut = limit;

    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, "");
  }
  if (rest) parts.push(rest);
  return parts;
}

export const TG = {
  api: call,

  // Надсилання тексту з автосплітом і явною перевіркою помилок
  async text(chat_id, text, opts = {}) {
    const token = opts.token;
    const chunks = splitForTg(text, SAFE_TG_MSG_LEN);

    for (const chunk of chunks) {
      await call(token, "sendMessage", {
        chat_id,
        text: chunk,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        reply_markup: opts.reply_markup,
      });
    }
  },

  setCommands(token, scope = null, commands = []) {
    return call(token, "setMyCommands", { commands, scope });
  },

  getWebhook(token) {
    return fetch(`${TG_API}/bot${token}/getWebhookInfo`);
  },

  // передаємо secret_token (опційно)
  setWebhook(token, url, secret) {
    const u = new URL(`${TG_API}/bot${token}/setWebhook`);
    u.searchParams.set("url", url);
    if (secret) u.searchParams.set("secret_token", secret);
    return fetch(u.toString());
  },

  deleteWebhook(token) {
    return fetch(`${TG_API}/bot${token}/deleteWebhook`);
  }
};