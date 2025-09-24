// Усі виклики Telegram API — в одному місці.

const API_BASE = "https://api.telegram.org/bot";

async function tg(env, method, payload) {
  const url = `${API_BASE}${env.TELEGRAM_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`TG ${method} ${res.status}: ${t}`);
  }
  return res.json();
}

export async function tgSendMessage(env, chat_id, text, extra = {}) {
  // легке "typing…" щоб виглядало живіше
  await tg(env, "sendChatAction", { chat_id, action: "typing" }).catch(() => {});
  return tg(env, "sendMessage", { chat_id, text, ...extra });
}