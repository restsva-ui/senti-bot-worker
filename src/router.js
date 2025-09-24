// src/router.js
// Дуже простий роутер: /start, фото, звичайний текст.
// Пізніше сюди легко додати інші команди.

/* Imports, синхронізовані з актуальними файлами */
import { tgSendMessage, tgSendAction, tgGetFileUrl } from "./adapters/telegram.js";
import { generateText, analyzeImage } from "./ai/providers.js";

/** Головний вхід для апдейта від Telegram */
export async function handleUpdate(update, env) {
  const msg = update?.message;
  if (!msg || !msg.chat || (!msg.text && !msg.caption && !msg.photo)) return;

  const chatId = msg.chat.id;
  const text = (msg.text ?? msg.caption ?? "").trim();
  const locale = (env.BOT_LOCALE || "uk").toLowerCase();

  // 1) Команда /start — коротке дружнє вітання (без згадки моделей)
  if (text.startsWith("/start")) {
    const hello =
      "Привіт! 🚀 Давай зробимо цей день яскравішим.\n\n" +
      "• Надішли *текст* — відповім лаконічно.\n" +
      "• Пришли *фото* — опишу та дам *висновки*.\n";
    await tgSendMessage(chatId, hello, { parse_mode: "Markdown" });
    return;
  }

  // 2) Якщо є фото — беремо найякісніше і робимо vision-аналіз
  if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
    try {
      await tgSendAction(chatId, "upload_photo");

      // беремо найбільший варіант (останній у масиві)
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const fileUrl = await tgGetFileUrl(env, fileId);

      const prompt =
        text && text.length > 0
          ? text
          : "Опиши зображення. Дай короткі висновки в кінці списком.";

      const reply = await analyzeImage(env, {
        imageUrl: fileUrl,
        prompt,
        locale,
      });

      await tgSendMessage(chatId, reply);
    } catch (e) {
      await tgSendMessage(
        chatId,
        "На жаль, не вдалося обробити зображення. Спробуй ще раз або надішли інше фото."
      );
      console.error("vision error:", e);
    }
    return;
  }

  // 3) Інакше — звичайний текст → текстова модель
  if (text) {
    try {
      await tgSendAction(chatId, "typing");

      const reply = await generateText(env, {
        prompt: text,
        locale,
      });

      await tgSendMessage(chatId, reply);
    } catch (e) {
      await tgSendMessage(
        chatId,
        "Хм… не вийшло відповісти. Спробуй переформулювати повідомлення."
      );
      console.error("text error:", e);
    }
  }
}