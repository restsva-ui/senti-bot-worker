// src/routes/admin.js
import { adminKeyboard } from "../lib/keyboard.js";

/** Команда, яка відкриває адмін-меню */
export function wantAdmin(text = "") {
  const t = String(text || "").trim().toLowerCase();
  return t === "/admin" || t === "меню" || t === "/menu";
}

// Невеличкий хелпер для звернень до Telegram API
async function tgCall(env, method, payload) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) {
    throw new Error(`${method} failed: ${res.status} ${res.statusText} ${JSON.stringify(json)}`);
  }
  return json.result;
}

/** Зареєструвати (і почистити старі) команди бота в Telegram */
export async function ensureBotCommands(env, chatId = null) {
  const commands = [
    { command: "start", description: "Запустити бота" },
    { command: "menu",  description: "Показати меню" },
    { command: "admin", description: "Адмін-меню (керування)" },
    { command: "ping",  description: "Перевірка зв'язку" },
    { command: "help",  description: "Довідка" },
  ];

  // Скидаємо chat-scope і ставимо нові
  if (chatId) {
    try { await tgCall(env, "deleteMyCommands", { scope: { type: "chat", chat_id: chatId } }); } catch (_) {}
    try { await tgCall(env, "setMyCommands", { commands, scope: { type: "chat", chat_id: chatId } }); } catch (_) {}
  }
  // На всяк випадок оновимо і default-scope
  try { await tgCall(env, "deleteMyCommands", {}); } catch (_) {}
  try { await tgCall(env, "setMyCommands", { commands }); } catch (_) {}
}

/**
 * Обробка адмін-команд і кнопок.
 * Повертає:
 *  - { text, keyboard }
 *  - { text, expect: 'backup-url'|'append-checklist', keyboard? }
 */
export async function handleAdminCommand(env, chatId, text) {
  const t = String(text || "").trim();

  // Показати меню
  if (wantAdmin(t)) {
    return {
      text:
        "Senti Admin\n— мінімальне меню керування:\n" +
        "• Drive пінг і список файлів\n" +
        "• Швидкий бекап за URL\n" +
        "• Додавання в чеклист",
      keyboard: adminKeyboard(),
    };
  }

  // Ці кнопки обробляє webhook, тут тільки дефолтні відповіді (UX)
  if (t === "drive ✅" || t === "/gdrive_ping_btn") {
    return { text: "Перевіряю Drive…", keyboard: adminKeyboard() };
  }

  if (t === "list 10 🧾" || t === "list 10" || t === "/list10_btn") {
    return { text: "Збираю останні 10 файлів…", keyboard: adminKeyboard() };
  }

  if (t === "backup url ⬆️" || t === "/backup_btn") {
    return {
      text: "Надішли URL для збереження у Drive. Можна додати назву після пробілу:\n`https://... файл.zip`",
      expect: "backup-url",
      keyboard: adminKeyboard(),
    };
  }

  if (t === "checklist ➕" || t === "/checklist_add_btn") {
    return {
      text: "Надішли *один рядок*, який додати в `senti_checklist.md`.",
      expect: "append-checklist",
      keyboard: adminKeyboard(),
    };
  }

  return null;
}