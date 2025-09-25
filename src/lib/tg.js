// src/lib/tg.js

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function apiBase(env) {
  return (env.API_BASE_URL || "https://api.telegram.org").replace(/\/+$/, "");
}

async function call(env, method, body) {
  const url = `${apiBase(env)}/bot${env.BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let text = "";
    try { text = await res.text(); } catch {}
    console.error("Telegram API error:", method, res.status, text);
  }
  return res;
}

// ---- функції ----
async function sendMessage(env, chat_id, text, reply_markup = undefined, extra = {}) {
  return call(env, "sendMessage", {
    chat_id,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup,
    ...extra,
  });
}

async function editMessageReplyMarkup(env, chat_id, message_id, reply_markup) {
  return call(env, "editMessageReplyMarkup", { chat_id, message_id, reply_markup });
}

async function answerCallbackQuery(env, callback_query_id, text = "", show_alert = false) {
  return call(env, "answerCallbackQuery", { callback_query_id, text, show_alert });
}

async function setMyCommands(env, commands) {
  return call(env, "setMyCommands", { commands });
}

// ---- експорт ----
export {
  sendMessage,
  editMessageReplyMarkup,
  answerCallbackQuery,
  setMyCommands,
};

// також старий формат
export const tg = {
  sendMessage,
  editMessageReplyMarkup,
  answerCallbackQuery,
  setMyCommands,
};