// Minimal Telegram API helpers with optional `extra` (reply_markup, parse_mode, etc.)

export async function sendMessage(env, chatId, text, extra = {}) {
  const body = {
    chat_id: chatId,
    text,
    ...extra,
  };

  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  // Do not throw on non-200 to avoid webhook retries storm
  try {
    return await r.json();
  } catch {
    return { ok: false, status: r.status };
  }
}

export async function editMessageReplyMarkup(env, chatId, messageId, replyMarkup) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/editMessageReplyMarkup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup,
    }),
  });
  try {
    return await r.json();
  } catch {
    return { ok: false, status: r.status };
  }
}
