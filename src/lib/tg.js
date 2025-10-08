// src/lib/tg.js
export const TG = {
  api(botToken, method, payload) {
    return fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
    });
  },

  text(chat_id, text, opts = {}) {
    return this.api(opts.token, "sendMessage", {
      chat_id,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
      reply_markup: opts.reply_markup,
    });
  },

  setCommands(token, scope = null, commands = []) {
    return this.api(token, "setMyCommands", { commands, scope });
  },

  getWebhook(token) {
    return fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  },

  // передаємо secret_token (опційно)
  setWebhook(token, url, secret) {
    const u = new URL(`https://api.telegram.org/bot${token}/setWebhook`);
    u.searchParams.set("url", url);
    if (secret) u.searchParams.set("secret_token", secret);
    return fetch(u.toString());
  },

  deleteWebhook(token) {
    return fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
  }
};