import { tgSendMessage, tgGetFileUrl } from "./adapters/telegram.js";

// Основна функція для обробки апдейтів
async function handleUpdate(update, env) {
  try {
    if (update.message?.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text.trim();

      if (text === "/start") {
        await tgSendMessage(chatId, "👋 Привіт! Я Senti — твій уважний помічник.\n\n• Надішли текст — відповім коротко і по суті.\n• Пришли фото чи PDF — опишу і зроблю висновки.\nСпробуй: просто напиши думку або кинь картинку.", env);
        return;
      }

      await tgSendMessage(chatId, `Готово! Я отримав твій запит і відповім простими словами:\n\n• ${text}`, env);
    }

    if (update.message?.photo || update.message?.document) {
      const chatId = update.message.chat.id;
      const caption = update.message.caption || "Файл";

      if (update.message.photo) {
        await tgSendMessage(chatId, `🖼️ Твій підпис: ${caption}\nБачу зображення, але не отримав його URL для аналізу.`, env);
      }

      if (update.message.document) {
        await tgSendMessage(chatId, `📄 Отримав документ "${update.message.document.file_name}". Скажи, що саме потрібно зробити: виписати текст, знайти числа/дати чи зробити висновок?`, env);
      }
    }
  } catch (err) {
    console.error("Router error:", err);
  }
}

// Дефолтний експорт для index.js
export default {
  async fetch(request, env, ctx) {
    if (request.method === "POST" && new URL(request.url).pathname === `/${env.WEBHOOK_SECRET}`) {
      const update = await request.json();
      await handleUpdate(update, env);
      return new Response("ok", { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  },
};