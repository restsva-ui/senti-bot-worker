// src/adapters/telegram.js
// Мінімальний і стабільний Telegram-адаптер з детальними логами.

const BASE = "https://api.telegram.org";

function getToken(env) {
  // Підтримуємо дві назви змінної середовища
  return env?.TELEGRAM_TOKEN || env?.TG_BOT_TOKEN;
}

async function callTG(method, payload, env) {
  const token = getToken(env);
  if (!token) throw new Error("Telegram bot token is missing (TELEGRAM_TOKEN / TG_BOT_TOKEN)");

  const url = `${BASE}/bot${token}/${method}`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error(`TG fetch ${method} failed:`, e?.message);
    throw e;
  }

  const txt = await res.text();
  let json = null;
  try { json = JSON.parse(txt); } catch { /* залишимо сирий текст */ }

  if (!res.ok || !json?.ok) {
    console.error(`TG API error: ${method}`, txt);
    throw new Error(`TG ${method} failed`);
  }

  return json.result;
}

export async function tgSendMessage(chat_id, text, extra = {}, env) {
  return callTG("sendMessage", { chat_id, text, parse_mode: "HTML", ...extra }, env);
}

export async function tgSendAction(chat_id, action = "typing", env) {
  return callTG("sendChatAction", { chat_id, action }, env);
}

export async function tgGetFileUrl(file_id, env) {
  const token = getToken(env);
  if (!token) throw new Error("Telegram bot token is missing (TELEGRAM_TOKEN / TG_BOT_TOKEN)");

  const getFileUrl = `${BASE}/bot${token}/getFile`;
  const res = await fetch(getFileUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id }),
  });

  const txt = await res.text();
  let json = null;
  try { json = JSON.parse(txt); } catch {}
  if (!res.ok || !json?.ok) {
    console.error("TG API error: getFile", txt);
    return null;
  }

  const path = json.result?.file_path;
  if (!path) return null;
  return `${BASE}/file/bot${token}/${path}`;
}