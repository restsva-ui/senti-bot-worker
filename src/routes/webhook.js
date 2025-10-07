// src/routes/webhook.js
import { adminKeyboard } from "../lib/keyboard.js";
import { wantAdmin, handleAdminCommand, ensureBotCommands } from "./admin.js";

/** Відправка повідомлення у Telegram */
async function send(env, payload) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  const body = {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    ...payload,
  };
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Зручно відповідати у той самий чат */
async function reply(env, chatId, text, keyboard) {
  const reply_markup = keyboard
    ? { keyboard, resize_keyboard: true, one_time_keyboard: false }
    : undefined;
  await send(env, { chat_id: chatId, text, reply_markup });
}

function ok() {
  return new Response("ok");
}
function badRequest(msg = "bad request") {
  return new Response(msg, { status: 400 });
}

export default async function webhook(request, env, ctx) {
  if (request.method !== "POST") return badRequest("only POST");

  let update;
  try {
    update = await request.json();
  } catch {
    return badRequest("invalid json");
  }

  // Витягуємо найімовірніші поля
  const msg =
    update.message ||
    update.edited_message ||
    (update.callback_query && update.callback_query.message) ||
    null;

  if (!msg || !msg.chat || !msg.chat.id) return ok();

  const chatId = msg.chat.id;
  const rawText =
    (update.message && update.message.text) ||
    (update.edited_message && update.edited_message.text) ||
    (update.callback_query && update.callback_query.data) ||
    "";

  const text = String(rawText || "").trim();
  const low = text.toLowerCase();

  // ==== базові команди
  if (low === "/ping") {
    await reply(env, chatId, "pong 🟢");
    return ok();
  }

  if (low === "/start") {
    // зареєструємо системне меню
    await ensureBotCommands(env).catch(() => {});
    // показати адмін-меню
    await reply(
      env,
      chatId,
      "Senti Admin\n— мінімальне меню керування:\n" +
        "• Drive пінг і список файлів\n" +
        "• Швидкий бекап за URL\n" +
        "• Додавання в чеклист",
      adminKeyboard()
    );
    return ok();
  }

  if (low === "/menu" || low === "/admin" || wantAdmin(low)) {
    await reply(
      env,
      chatId,
      "Senti Admin\n— мінімальне меню керування:\n" +
        "• Drive пінг і список файлів\n" +
        "• Швидкий бекап за URL\n" +
        "• Додавання в чеклист",
      adminKeyboard()
    );
    return ok();
  }

  if (low === "/help") {
    await reply(
      env,
      chatId,
      "Доступні команди:\n" +
        "/start — запустити бота\n" +
        "/menu — адмін-меню\n" +
        "/ping — перевірка зв'язку"
    );
    return ok();
  }

  // ==== ГОЛОВНЕ: пробуємо обробити як кнопку/адмін-команду
  try {
    const res = await handleAdminCommand(env, chatId, text);
    if (res) {
      const keyboard = res.keyboard ? res.keyboard : adminKeyboard();
      await reply(env, chatId, res.text, keyboard);
      // (опціональні очікування наступного кроку можна зберегти у state,
      // якщо потрібно — зараз пропускаємо)
      return ok();
    }
  } catch (e) {
    await reply(env, chatId, "Помилка: " + String(e?.message || e));
    return ok();
  }

  // Нічого не впізнали — мовчимо (або дайте підказку)
  // await reply(env, chatId, "Команда не розпізнана. Надішліть /menu.");
  return ok();
}