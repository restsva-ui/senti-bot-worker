// Роутер Telegram-апдейтів: /start, звичайний текст, кнопки

import { tgSendMessage, tgSendAction, tgGetFileUrl } from './adapters/telegram.js';
import { aiText, aiVision } from './ai/providers.js';

export async function handleUpdate(update, env) {
  const msg = update.message || update.edited_message || null;
  const cq = update.callback_query || null;

  // Якщо прийшла callback_query — просто підтвердимо, щоби не висіло "годинник"
  if (cq) {
    // Можна додати логіку, якщо буде меню.
    return new Response('ok');
  }

  if (!msg || !msg.chat) return new Response('ok');

  const chatId = msg.chat.id;
  const text = (msg.text ?? msg.caption ?? '').trim();

  // --- /start ---
  if (text.startsWith('/start')) {
    const hello =
      '👋 Привіт! Я Senti — твій уважний помічник.\n' +
      '• Надішли текст — відповім коротко і по суті.\n' +
      '• Пришли фото чи PDF — опишу і зроблю висновки.\n' +
      'Спробуй: просто напиши думку або кинь картинку.';
    await tgSendMessage(env, chatId, hello);
    return new Response('ok');
  }

  // --- Медія з підписом (поки що як звичайний текст) ---
  if (msg.photo || msg.document) {
    await tgSendAction(env, chatId, 'typing');
    const prompt = text || 'Опиши це простими словами.';
    const reply = await aiText({ prompt, env });
    await tgSendMessage(env, chatId, reply);
    return new Response('ok');
  }

  // --- Звичайний текст ---
  if (text) {
    await tgSendAction(env, chatId, 'typing');
    const reply = await aiText({ prompt: text, env });
    await tgSendMessage(env, chatId, reply);
    return new Response('ok');
  }

  // Якщо нічого з вище — мовчки ок
  return new Response('ok');
}