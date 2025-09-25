// src/lib/tg.js
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function apiUrl(env, method) {
  const base = (env.API_BASE_URL || "https://api.telegram.org").replace(/\/+$/, "");
  return `${base}/bot${env.BOT_TOKEN}/${method}`;
}

export async function tg(env, method, body) {
  return fetch(apiUrl(env, method), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

export async function sendMessage(env, body) {
  return tg(env, "sendMessage", body);
}

export async function answerCallbackQuery(env, body) {
  return tg(env, "answerCallbackQuery", body);
}

export async function editMessageText(env, body) {
  return tg(env, "editMessageText", body);
}

export async function sendPhoto(env, body) {
  return tg(env, "sendPhoto", body);
}

export async function sendDocument(env, body) {
  return tg(env, "sendDocument", body);
}

// ✅ тільки іменовані експорти (без default!)