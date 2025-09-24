// Дуже простий роутер: /start, текст, фото
import { tgSendMessage, tgSendChatAction, tgGetFileUrl } from "./adapters/telegram.js";
import { aiText, aiVision } from "./ai/providers.js";

export async function handleUpdate(update, env) {
  try {
    const msg = update.message || update.edited_message;
    const cb  = update.callback_query;

    // Якщо callback_query — поки просто ігноруємо
    if (!msg && !cb) return;

    const chatId = (msg?.chat?.id) || (cb?.message?.chat?.id);
    if (!chatId) return;

    // Текст/підпис
    const text = (msg?.text ?? msg?.caption ?? "").trim();

    // 1) Команда /start
    if (text.startsWith("/start")) {
      const hello =
        "👋 Привіт! Я Senti.\n" +
        "Надішли текст — відповім лаконічно.\n" +
        "Надішли фото — опишу й зроблю висновки.\n" +
        "Спробуй прямо зараз.";
      await tgSendMessage(env, chatId, hello);
      return;
    }

    // 2) Фото → Vision
    const photos = msg?.photo;
    if (Array.isArray(photos) && photos.length > 0) {
      // Telegram надсилає кілька розмірів — беремо найбільший
      const best = photos[photos.length - 1];
      if (!best?.file_id) return;

      await tgSendChatAction(env, chatId, "typing");

      const fileUrl = await tgGetFileUrl(env, best.file_id);
      if (!fileUrl) {
        await tgSendMessage(env, chatId, "Не вдалося отримати фото. Спробуй ще раз 🙏");
        return;
      }

      const userHint = text ? `Користувач додав підпис: "${text}".` : "";
      const prompt =
        "Проаналізуй зображення. Коротко опиши, виділи ключові об’єкти, " +
        "поміркуй про контекст та дай стислий висновок. " + userHint;

      const answer = await aiVision(env, fileUrl, prompt);
      await tgSendMessage(env, chatId, answer || "Не вдалось згенерувати відповідь 😅");
      return;
    }

    // 3) Простий текст → Text
    if (text) {
      await tgSendChatAction(env, chatId, "typing");

      const system =
        "Ти дружній помічник Senti. Відповідай стисло, корисно, без згадки внутрішніх моделей. " +
        "Українська мова за замовчуванням.";

      const answer = await aiText(env, text, { system });
      await tgSendMessage(env, chatId, answer || "Я трохи загубився 🤔 Спробуй переформулювати.");
      return;
    }

    // Інакше — мовчимо
  } catch (e) {
    // Фейл-сейф: не падаємо
    // Можеш вмикати логування, якщо потрібно:
    // console.log("router error", e?.message);
  }
}