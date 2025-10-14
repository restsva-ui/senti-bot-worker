// src/telegram/helpers.js
export const json = (data, init = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });

// Markdown link detector
const hasMdLinks = (s = "") => /\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(String(s));
// Simple HTML tag detector
const looksLikeHtml = (s = "") => /<\/?[a-z][\s>]/i.test(String(s));

export async function sendMessage(env, chatId, text, extra = {}) {
  const payload = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(looksLikeHtml(text) ? { parse_mode: "HTML" } : hasMdLinks(text) ? { parse_mode: "Markdown" } : {}),
    ...extra,
  };
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  await r.text().catch(() => {});
}

export const sendHtml = (env, chatId, html, extra = {}) =>
  sendMessage(env, chatId, html, { parse_mode: "HTML", disable_web_page_preview: true, ...extra });

export const arrow = (url) => (url ? ` <a href="${url}">↗︎</a>` : "");
