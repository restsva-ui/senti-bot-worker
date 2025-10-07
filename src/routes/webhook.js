// src/routes/webhook.js
import { showAdminMenu, handleAdminButtons } from "./admin.js";
import { sendMessage } from "../lib/telegram.js";
import { clearState } from "../lib/state.js";

export default async function webhook(request, env) {
  let update = {};
  try { update = await request.json(); } catch {}

  const msg = update.message || update.edited_message;
  if (!msg) return new Response("ok");

  const chatId = msg.chat?.id;
  const text = (msg.text || "").trim();

  // Перевірка секрету Telegram (за наявності)
  const sec = env.TELEGRAM_SECRET_TOKEN ?? "";
  if (sec) {
    const header = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
    if (header !== sec) return new Response("forbidden", { status: 403 });
  }

  // Команди
  if (text === "/start") {
    await clearState(env, chatId, "awaiting_url");
    await clearState(env, chatId, "awaiting_checklist_line");
    await sendMessage(
      env,
      chatId,
      "Доступні команди:\n/start — запустити бота\n/menu — адмін-меню\n/ping — перевірка зв'язку"
    );
    return new Response("ok");
  }

  if (text === "/help") {
    await sendMessage(
      env,
      chatId,
      "Команди:\n/start, /menu, /ping\n\nВ адмін-меню — кнопки Drive, List, Backup URL, Checklist."
    );
    return new Response("ok");
  }

  if (text === "/ping") {
    await sendMessage(env, chatId, "pong 🟢");
    return new Response("ok");
  }

  // /menu і /admin показують одну панель
  if (text === "/menu" || text === "/admin") {
    await showAdminMenu(env, chatId);
    return new Response("ok");
  }

  // Обробка кнопок/станів
  await handleAdminButtons(env, chatId, text);
  return new Response("ok");
}