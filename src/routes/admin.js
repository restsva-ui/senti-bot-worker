import { adminKeyboard } from "../lib/keyboard.js";

// допоміжне
async function tgCall(env, method, body) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 1) Реєструємо команди Telegram (щоб /admin був у головному меню клієнта)
export async function ensureBotCommands(env) {
  const commands = [
    { command: "start", description: "Запустити бота" },
    { command: "help", description: "Довідка" },
    { command: "ping", description: "Перевірка зв'язку" },
    { command: "menu", description: "Меню" },
    { command: "admin", description: "Адмін-панель" },
  ];
  try {
    await tgCall(env, "setMyCommands", { commands });
  } catch (_) {}
}

// 2) Тригер адмін-панелі (команда /admin або текст кнопки "Меню" коли хочемо вивести панель)
export function wantAdmin(text) {
  const t = (text || "").trim().toLowerCase();
  return t === "/admin";
}

// 3) Відправка самої панелі
export async function handleAdminCommand(env, chatId) {
  const text =
    "Senti Admin\n— мінімальне меню керування:\n" +
    "• Drive пінг і список файлів\n" +
    "• Швидкий бекап за URL\n" +
    "• Додавання в чеклист";
  try {
    // опис
    await tgCall(env, "sendMessage", {
      chat_id: chatId,
      text,
    });
    // клавіатура
    await tgCall(env, "sendMessage", {
      chat_id: chatId,
      text: " ",
      ...adminKeyboard(),
    });
  } catch (_) {}
}