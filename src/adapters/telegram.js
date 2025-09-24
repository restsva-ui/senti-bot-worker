// src/adapters/telegram.js
/**
 * Чистий адаптер Telegram API для Cloudflare Workers
 * - коректно будує URL у форматі: https://api.telegram.org/bot<TOKEN>/<method>
 * - детально логує URL запиту при помилках (щоб 404 було легко діагностувати)
 */

const TG_ORIGIN = "https://api.telegram.org";

/** Базовий виклик Telegram API */
async function tgCall(env, method, payload) {
  const token = env.TG_BOT_TOKEN;
  if (!token) {
    console.error("TG token is missing in env.TG_BOT_TOKEN");
    return { ok: false, error: "NO_TOKEN" };
  }

  const url = `${TG_ORIGIN}/bot${token}/${method}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { ok: false, raw: text }; }

    if (!res.ok || !data?.ok) {
      console.error(`TG API error: ${method} ${JSON.stringify(data)} | url=${url}`);
    }
    return data;
  } catch (e) {
    console.error(`TG fetch failed: ${method} url=${url} err=${e?.message || e}`);
    return { ok: false, error: e?.message || String(e) };
  }
}

/** Надіслати повідомлення */
export async function tgSendMessage(env, chat_id, text, extra = {}) {
  return tgCall(env, "sendMessage", {
    chat_id,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
}

/** Дія "друкує..." тощо */
export async function tgSendChatAction(env, chat_id, action = "typing") {
  return tgCall(env, "sendChatAction", { chat_id, action });
}

/** Відповісти на callback_query */
export async function tgAnswerCallback(env, callback_query_id, opts = {}) {
  return tgCall(env, "answerCallbackQuery", {
    callback_query_id,
    ...opts,
  });
}

/** Отримати публічний URL файлу (file_path) */
export async function tgGetFileUrl(env, file_id) {
  const fileInfo = await tgCall(env, "getFile", { file_id });
  const token = env.TG_BOT_TOKEN;
  if (fileInfo?.ok && fileInfo.result?.file_path) {
    return `${TG_ORIGIN}/file/bot${token}/${fileInfo.result.file_path}`;
  }
  return null;
}