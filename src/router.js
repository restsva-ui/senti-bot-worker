// Дуже обережний роутер: завжди відповідає.
// Багато логів, щоб ловити причини мовчанки.

import { tgSendMessage, tgSendAction, tgGetFileUrl } from "./adapters/telegram.js";
import { aiText, aiVision } from "./ai/providers.js";

export async function handleUpdate(update, env, ctx) {
  try {
    const msg = update?.message || update?.edited_message || null;
    if (!msg || !msg.chat) {
      console.info("No message in update (maybe callback_query, etc.)");
      return;
    }

    const chatId = msg.chat.id;
    const textIn = (msg.text ?? "").trim();
    const captionIn = (msg.caption ?? "").trim();
    const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
    const hasDoc = !!msg.document;

    // Завжди показуємо, що «друкуємо»
    try { await tgSendAction(chatId, "typing", env); } catch (e) {
      console.error("tgSendAction error:", e?.message);
    }

    // /start — дружнє вітання
    if (textIn.startsWith("/start")) {
      const hello = [
        "👋 Привіт! Я Senti — твій уважний помічник.",
        "• Надішли текст — відповім коротко і по суті.",
        "• Пришли фото чи PDF — опишу і зроблю висновки.",
        "Спробуй: просто напиши думку або кинь картинку.",
      ].join("\n");
      await safeSend(chatId, hello, env, msg);
      return;
    }

    // Фото / документ
    if (hasPhoto || hasDoc) {
      let fileId = null;
      let mime = null;

      if (hasPhoto) {
        // беремо найбільну (остання у масиві)
        fileId = msg.photo[msg.photo.length - 1]?.file_id;
        mime = "image/jpeg"; // TG для photo не присилає mime — ставимо дефолт
      } else if (hasDoc) {
        fileId = msg.document.file_id;
        mime = msg.document.mime_type || "application/octet-stream";
      }

      let fileUrl = null;
      try {
        fileUrl = await tgGetFileUrl(fileId, env);
      } catch (e) {
        console.error("tgGetFileUrl error:", e?.message);
      }

      // Якщо з якоїсь причини не змогли дістати url або байти — даємо стабільну відповідь
      if (!fileUrl) {
        const fallback = [
          "📝 Бачу зображення/файл.",
          "Не вдалося отримати прямий URL від Telegram (це нормально іноді).",
          "Я все одно можу дати базову відповідь. Напиши, що саме цікавить на цьому зображенні/у файлі.",
        ].join("\n");
        await safeSend(chatId, fallback, env, msg);
        return;
      }

      // Завантажимо байти (без зовнішніх CV)
      let bytes = null;
      try {
        const res = await fetch(fileUrl);
        if (res.ok) bytes = await res.arrayBuffer();
      } catch (e) {
        console.error("download file error:", e?.message);
      }

      const visionReply = await aiVision(
        { bytes, mime, caption: captionIn || textIn || "" },
        env
      );
      await safeSend(chatId, visionReply, env, msg);
      return;
    }

    // Текст
    if (textIn.length > 0) {
      const reply = await aiText(textIn, env);
      await safeSend(chatId, reply, env, msg);
      return;
    }

    // Взагалі без тексту/медіа
    await safeSend(
      chatId,
      "Я бачу апдейт без тексту та без файлу. Напиши повідомлення або пришли фото/документ.",
      env,
      msg
    );
  } catch (e) {
    console.error("handleUpdate fatal:", e?.message);
  }
}

// Надсилання з друзнім логуванням помилок
async function safeSend(chatId, text, env, msg) {
  try {
    await tgSendMessage(chatId, text, { reply_to_message_id: msg?.message_id }, env);
  } catch (e) {
    console.error("tgSendMessage error:", e?.message);
  }
}