import { tgSendMessage, tgSendAction } from "./adapters/telegram.js";
import { generateText } from "./ai/providers.js";
import { handlePhotoMessage } from "./media.js";
import { TXT } from "./lang.js";
import { memGet, memSet } from "./ai/redis.js";

export async function handleUpdate(update, env) {
  const msg = update.message;
  if (!msg || !msg.chat) return;

  const chatId = msg.chat.id;
  const text = (msg.text ?? msg.caption ?? "").trim();

  // /start
  if (text.startsWith("/start")) {
    const name = msg.from?.first_name;
    return tgSendMessage(chatId, TXT.hello(name), env);
  }

  // Photo
  if (msg.photo && msg.photo.length) {
    await tgSendAction(chatId, "typing", env);
    try {
      const answer = await handlePhotoMessage(update, env);
      return tgSendMessage(chatId, answer, env);
    } catch {
      return tgSendMessage(chatId, TXT.error, env);
    }
  }

  // Text
  if (text) {
    await tgSendAction(chatId, "typing", env);
    try {
      // короткий контекст-пам'ять (останнє запитання)
      await memSet(chatId, text, env);
      const reply = await generateText(text, env);
      return tgSendMessage(chatId, reply, env);
    } catch {
      return tgSendMessage(chatId, TXT.error, env);
    }
  }
}