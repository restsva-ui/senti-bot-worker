//////////////////////////////
// tg.js — Telegram API
//////////////////////////////

export class TG {
  constructor(token) {
    this.token = token;
    this.base = `https://api.telegram.org/bot${token}`;
  }

  async sendMessage(chat_id, text, extra = {}) {
    return this.req("sendMessage", { chat_id, text, ...extra });
  }

  async answerCallback(cb, text, show_alert = false) {
    return this.req("answerCallbackQuery", {
      callback_query_id: cb.id,
      text,
      show_alert,
    });
  }

  async req(method, data) {
    const res = await fetch(`${this.base}/${method}`, {
      method: "POST",
      body: JSON.stringify(data),
      headers: { "content-type": "application/json" },
    });
    return res.json();
  }

  async getFileLink(fileId) {
    const res = await this.req("getFile", { file_id: fileId });
    if (!res.ok) return null;
    return `https://api.telegram.org/file/bot${this.token}/${res.result.file_path}`;
  }
}
