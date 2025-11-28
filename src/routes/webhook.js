// src/routes/webhook.js

import { handleMessage } from "../flows/handleMessage.js";
import { handleCallback } from "../flows/handleCallback.js";
import { handlePhoto } from "../flows/handlePhoto.js";

export default async function webhook(req, env, ctx) {
  const update = await req.json();
  const tgContext = { env, ctx, req };

  // Фото
  if (update.message?.photo) {
    return await handlePhoto(update, tgContext);
  }

  // Callback (кнопки)
  if (update.callback_query) {
    return await handleCallback(update, tgContext);
  }

  // Текстові повідомлення
  if (update.message?.text) {
    return await handleMessage(update, tgContext);
  }

  // Якщо тип не розпізнано — заглушка
  return new Response("OK", { status: 200 });
}
