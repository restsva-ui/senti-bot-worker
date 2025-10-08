// src/lib/tg.js
export const TG = {
  async api(botToken, method, payload) {
    const url = `https://api.telegram.org/bot${botToken}/${method}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
    });

    // Спробуємо розпарсити відповідь, навіть якщо статус не 200
    let data = {};
    try { data = await res.json(); } catch {}

    if (!res.ok || data?.ok === false) {
      const desc = data?.description || "";
      throw new Error(`Telegram API error ${method} ${res.status} ${desc}`);
    }
    return data;
  },

  /**
   * Надсилання тексту в чат.
   * - За замовчуванням БЕЗ parse_mode (plain text) — безпечніше для довільного контенту.
   * - Якщо потрібно, передай opts.parse_mode ("MarkdownV2" або "HTML").
   * - Довгі повідомлення діляться на шматки ~3500 символів.
   */
  async text(chat_id, text, opts = {}) {
    const base = {
      chat_id,
      text,
      disable_web_page_preview: true,
      // додаємо reply_markup, якщо є
      ...(opts.reply_markup ? { reply_markup: opts.reply_markup } : {}),
    };
    // Додаємо parse_mode лише якщо явно переданий
    if (opts.parse_mode) base.parse_mode = opts.parse_mode;

    // Телеграм має ліміт ~4096 символів. Візьмемо трохи запасу.
    const MAX = 3500;
    const chunks = [];

    const s = String(text ?? "");
    if (s.length <= MAX) {
      chunks.push(s);
    } else {
      // Розбиваємо по рядках, намагаючись не різати слова.
      let buf = "";
      for (const line of s.split("\n")) {
        if ((buf + line + "\n").length > MAX) {
          chunks.push(buf);
          buf = "";
        }
        buf += line + "\n";
      }
      if (buf) chunks.push(buf);
    }

    let last;
    for (const part of chunks) {
      last = await this.api(opts.token, "sendMessage", { ...base, text: part });
    }
    return last;
  },

  setCommands(token, scope = null, commands = []) {
    return this.api(token, "setMyCommands", { commands, scope });
  },

  getWebhook(token) {
    return fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  },

  // Передаємо secret_token (опційно)
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