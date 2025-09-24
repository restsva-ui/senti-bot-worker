import { tgSendMessage, tgSendAction, tgGetFileUrl } from "./adapters/telegram.js";
import { aiText, aiVision } from "./ai/providers.js";

export async function handleUpdate(update, env, ctx) {
  try {
    const msg = update?.message || update?.edited_message || update?.channel_post || null;
    if (!msg?.chat?.id) {
      console.info("No message/chat in update");
      return;
    }

    const chatId = msg.chat.id;
    const textIn = (msg.text ?? "").trim();
    const captionIn = (msg.caption ?? "").trim();
    const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
    const hasDoc = !!msg.document;

    // індикатор «друкує»
    try { await tgSendAction(chatId, "typing", env); } catch (e) { console.error("tgSendAction:", e?.message); }

    // /start
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

    // Фото/документ
    if (hasPhoto || hasDoc) {
      let fileId = null;
      let mime = null;

      if (hasPhoto) {
        fileId = msg.photo[msg.photo.length - 1]?.file_id; // найбільша
        mime = "image/jpeg";
      } else {
        fileId = msg.document.file_id;
        mime = msg.document.mime_type || "application/octet-stream";
      }

      let fileUrl = null;
      try {
        fileUrl = await tgGetFileUrl(fileId, env);
        console.info("fileUrl:", fileUrl ? "ok" : "null");
      } catch (e) {
        console.error("tgGetFileUrl:", e?.message);
      }

      let bytes = null;
      if (fileUrl) {
        try {
          const res = await fetch(fileUrl);
          if (res.ok) bytes = await res.arrayBuffer();
          else console.error("download file status:", res.status);
        } catch (e) {
          console.error("download file:", e?.message);
        }
      }

      const answer = await aiVision(
        { bytes, mime, caption: captionIn || textIn || "" },
        env
      );
      await safeSend(chatId, answer, env, msg);
      return;
    }

    // Текст
    if (textIn.length > 0) {
      const answer = await aiText(textIn, env);
      await safeSend(chatId, answer, env, msg);
      return;
    }

    // Порожній апдейт
    await safeSend(
      chatId,
      "Я бачу апдейт без тексту й без файлу. Напиши повідомлення або пришли фото/документ.",
      env,
      msg
    );
  } catch (e) {
    console.error("handleUpdate fatal:", e?.message);
  }
}

async function safeSend(chatId, text, env, msg) {
  try {
    await tgSendMessage(chatId, text || "😅 Відповідь порожня, але я на зв’язку.", { reply_to_message_id: msg?.message_id }, env);
  } catch (e) {
    console.error("tgSendMessage:", e?.message);
  }
}