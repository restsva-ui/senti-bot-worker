// src/lib/tg.js
// Helper для Telegram API з безпечним розбиттям довгих повідомлень.
// За замовчуванням вимикаємо web-preview, parse_mode не нав'язуємо.

export const TG = {
  async api(botToken, method, payload) {
    const url = `https://api.telegram.org/bot${botToken}/${method}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
    });

    // Парсимо відповідь навіть якщо не 200
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
   * - За замовчуванням БЕЗ parse_mode (plain text).
   * - Якщо потрібно, передай opts.parse_mode ("MarkdownV2" або "HTML").
   * - Довгі повідомлення діляться на шматки ~3500 символів.
   * - Прев’ю лінків вимкнено за замовчуванням.
   * - Важливо: передавай opts.token (BOT_TOKEN) — API його використовує.
   */
  async text(chat_id, text, opts = {}) {
    const base = {
      chat_id,
      text,
      disable_web_page_preview: true,
      ...(opts.reply_markup ? { reply_markup: opts.reply_markup } : {}),
    };
    if (opts.parse_mode) base.parse_mode = opts.parse_mode;

    const MAX = 3500;
    const chunks = [];
    const s = String(text ?? "");
    if (s.length <= MAX) {
      chunks.push(s);
    } else {
      let buf = "";
      for (const line of s.split("\n")) {
        const next = buf + line + "\n";
        if (next.length > MAX) {
          if (buf) chunks.push(buf);
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

  // ---------- Commands ----------
  setCommands(token, scope = null, commands = []) {
    return this.api(token, "setMyCommands", { commands, scope });
  },

  getWebhook(token) {
    // Повертаємо сирий fetch — вище нехай сам викликає .json() за потреби
    return fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  },

  // ---------- Webhook ----------
  setWebhook(token, url, secret) {
    const u = new URL(`https://api.telegram.org/bot${token}/setWebhook`);
    u.searchParams.set("url", url);
    if (secret) u.searchParams.set("secret_token", secret);
    return fetch(u.toString());
  },

  deleteWebhook(token) {
    return fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
  },

  // ---------- Files ----------
  /**
   * Отримує метадані файлу Telegram (file_path)
   * і повертає пряме посилання https://api.telegram.org/file/bot<token>/<file_path>
   */
  async getFileLink(botToken, file_id) {
    const data = await this.api(botToken, "getFile", { file_id });
    const path = data?.result?.file_path;
    if (!path) throw new Error(`Не вдалося отримати file_path для ${file_id}`);
    return `https://api.telegram.org/file/bot${botToken}/${path}`;
  },
};
