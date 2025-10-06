import { json, badRequest, forbidden } from "../lib/resp.js";
import { verifyWebhookSecret } from "../lib/verify.js";
import { sendMessage } from "../lib/telegram.js";

export async function handleWebhook(request, env) {
  // Безпека: перевіряємо секрет
  if (!verifyWebhookSecret(request, env)) {
    return forbidden("Invalid webhook secret");
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  // Підтримуємо message та edited_message
  const msg = update.message || update.edited_message;
  const chatId = msg?.chat?.id;
  const text = msg?.text ?? "";

  // Мінімальна логіка: echo, щоб перевірити зв’язок
  if (chatId) {
    const reply = text
      ? `👋 Привіт! Ти написав: ${text}`
      : "👋 Привіт! Надішли мені текстове повідомлення.";
    try {
      await sendMessage(env, chatId, reply);
    } catch (e) {
      // Не падаємо 500, просто звітуємо у відповіді вебхуку
      return json({ ok: true, delivered: false, error: String(e?.message || e) });
    }
  }

  return json({ ok: true });
}