async function tgCall(env, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data?.description || `HTTP ${res.status}`);
  }
  return data.result ?? true;
}

export async function sendMessage(env, chatId, text, extra = {}) {
  return tgCall(env, "sendMessage", { chat_id: chatId, text, ...extra });
}