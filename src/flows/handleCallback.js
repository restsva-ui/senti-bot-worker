// src/flows/handleCallback.js

import { TG } from "../lib/tg.js";
import { t } from "../lib/i18n.js";

const { sendPlain, mainKeyboard, ADMIN } = TG;

export async function handleCallback(update, tgContext) {
  const env = tgContext.env;
  const callback = update.callback_query;
  const userId = callback.from?.id;
  const chatId = callback.message?.chat?.id;
  const data = callback.data || "";
  const isAdmin = ADMIN(env, userId);

  // Відповідаємо Telegram, щоб кнопка не крутилася вічно
  try {
    const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
    if (token) {
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callback_query_id: callback.id }),
      });
    }
  } catch {}

  // Обробка callback-команд
  if (data === "refresh_admin") {
    await sendPlain(env, chatId, "Дані оновлено.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return new Response("OK");
  }

  // ... інші callback-команди тут (додавай власні варіанти)

  // Дефолт: повідомлення, що кнопка оброблена
  await sendPlain(env, chatId, t("uk", "Готово!"));
  return new Response("OK");
}
