// src/flows/handlePhoto.js
import { TG } from "../lib/tg.js";
import { visionDescribe } from "./visionDescribe.js";
import { diagWrap } from "../lib/diag.js";

export const handlePhoto = diagWrap("handlePhoto", async ({ env, chat_id, message_id, photos, caption, userLang }) => {
  const photo = photos?.[photos.length - 1];
  if (!photo?.file_id) throw new Error("No photo file_id");

  // Було: TG.getFile(...) -> інколи падає як "is not a function"
  // Стабільно: напряму через TG.callApi("getFile")
  const file = await TG.callApi(env, "getFile", { file_id: photo.file_id });
  const file_path = file?.result?.file_path;
  if (!file_path) throw new Error("TG.getFile: missing file_path");
  const file_url = `https://api.telegram.org/file/bot${env.TELEGRAM_TOKEN}/${file_path}`;

  const prompt = caption || "";
  const vision = await visionDescribe({
    env,
    imageUrl: file_url,
    prompt,
    userLang,
  });

  const text = (vision?.text || vision?.answer || vision?.content || "").trim() || (userLang === "ru"
    ? "Не удалось описать фото."
    : "Не вдалося описати фото.");

  await TG.sendMessage(env, chat_id, text, {
    reply_to_message_id: message_id,
  });

  return { ok: true };
});
