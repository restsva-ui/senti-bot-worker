// src/routes/webhook.js
import { showAdminMenu, handleAdminButtons } from "./admin.js";
import { sendMessage } from "../lib/telegram.js";
import { clearState } from "../lib/state.js";
import { verifyWebhookSecret } from "../lib/verify.js";

export default async function webhook(request, env) {
  // Якщо задано WEBHOOK_SECRET — перевіряємо кожен запит
  if (env.WEBHOOK_SECRET) {
    try {
      if (!verifyWebhookSecret(request, env)) {
        return new Response("forbidden", { status: 403 });
      }
    } catch {
      return new Response("forbidden", { status: 403 });
    }
  }

  let update = {};
  try { update = await request.json(); } catch {}

  const msg = update.message || update.edited_message || update.callback_query?.message;
  if (!msg) return new Response("ok");

  const chatId = msg.chat?.id;
  const text = (update.message?.text || update.edited_message?.text || update.callback_query?.data || "").trim();

  // /start → чистимо стан і показуємо меню
  if (text === "/start") {
    try { await clearState(env, chatId, "*"); } catch {}
    await sendMessage(env, chatId, "👋 Привіт! Готовий до роботи.");
    await showAdminMenu(env, chatId);
    return new Response("ok");
  }

  // Швидка перевірка
  if (text === "/ping") {
    await sendMessage(env, chatId, "pong 🟢");
    return new Response("ok");
  }

  // /menu або /admin → панель
  if (text === "/menu" || text === "/admin") {
    await showAdminMenu(env, chatId);
    return new Response("ok");
  }

  // Інше — уніфікований обробник кнопок/станів
  try {
    await handleAdminButtons(env, chatId, text);
  } catch (e) {
    await sendMessage(env, chatId, `Помилка: ${String(e?.message || e)}`);
  }
  return new Response("ok");
}