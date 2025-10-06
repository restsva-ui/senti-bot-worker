import { json, badRequest, forbidden } from "../lib/resp.js";
import { verifyWebhookSecret } from "../lib/verify.js";
import { sendMessage } from "../lib/telegram.js";

export async function handleWebhook(request, env) {
  if (!verifyWebhookSecret(request, env)) {
    // ВАЖЛИВО: повертай 200, щоб Telegram не ретраїв безкінечно
    return json({ ok: true, ignored: true, reason: "bad secret" });
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return badRequest("invalid json");
  }

  const msg = update.message || update.edited_message || update.channel_post;
  const chatId = msg?.chat?.id;
  const text = msg?.text || msg?.caption || "";

  if (chatId) {
    const reply = text
      ? `✅ Сенті онлайн.\nТи написав: "${text}"`
      : "✅ Сенті онлайн. Надішли текстове повідомлення.";
    // не ламаємо відповідь вебхуку, навіть якщо Telegram відмовив
    try { await sendMessage(env, chatId, reply); } catch (e) { /* ignore */ }
  }

  return json({ ok: true });
}