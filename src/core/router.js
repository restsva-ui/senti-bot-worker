// Дуже простий роутер: команди /start і все інше як текст.
// Пізніше додамо vision/documents/codegen.

import { tgSendMessage } from "../adapters/telegram.js";

export async function handleUpdate(update, env) {
  const msg = update.message;
  if (!msg || !msg.chat || (!msg.text && !msg.caption)) return;

  const chatId = msg.chat.id;
  const text = (msg.text ?? msg.caption ?? "").trim();

  // Команда /start — коротке дружнє вітання (без згадки моделей)
  if (text.startsWith("/start")) {
    const hello =
      "Привіт! Я — Senti. Надішли текст або фото — допоможу швидко й по суті. 🚀";
    await tgSendMessage(env, chatId, hello, { parse_mode: "Markdown" });
    return;
  }

  // Поки що заглушка: просто повторюємо (echo-lite).
  // Далі підключимо LLM і решту фіч.
  await tgSendMessage(env, chatId, `Я почув: _${escapeMd(text)}_`, {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  });
}

// Маленький хелпер для Markdown-escape
function escapeMd(s) {
  return s.replace(/([_*[\]()~`>#+\-=|{}.!])/g, "\\$1");
}
