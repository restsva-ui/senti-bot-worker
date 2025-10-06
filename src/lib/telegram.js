async function tgFetch(env, method, payload) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const err = data?.description || `HTTP ${res.status}`;
    throw new Error(`Telegram error: ${err}`);
  }
  return data.result ?? true;
}

export async function sendMessage(env, chatId, text, extra = {}) {
  return tgFetch(env, "sendMessage", { chat_id: chatId, text, ...extra });
}