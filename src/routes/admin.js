import { adminKeyboard } from "../lib/keyboard.js";
import { driveList, driveAppendLog } from "../lib/drive.js";

/** Чи хочемо показати адмін-панель для цього тексту */
export function wantAdmin(text) {
  return text === "/admin" || text === "/menu" || text === "Меню";
}

/** Регіструємо команди бота (щоб у підказках з’явилася /admin) */
export async function ensureBotCommands(env) {
  try {
    const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/setMyCommands`;
    const commands = [
      { command: "start", description: "Запустити бота" },
      { command: "help", description: "Довідка" },
      { command: "ping", description: "Перевірка зв'язку" },
      { command: "menu", description: "Меню" },
      { command: "admin", description: "Адмін-панель" },
    ];
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commands, scope: { type: "default" }, language_code: "uk" }),
    });
  } catch (_) {}
}

/** Обробник кнопок/команд адмін-панелі */
export async function handleAdminCommand(env, chatId, text) {
  if (text === "/admin" || text === "/menu" || text === "Меню") {
    return {
      text:
        "Senti Admin\n— мінімальне меню керування:\n" +
        "• Drive пінг і список файлів\n" +
        "• Швидкий бекап за URL\n" +
        "• Додавання в чеклист",
      keyboard: adminKeyboard(),
    };
  }

  if (text === "Drive ✅") {
    return { text: "🟢 Drive OK" };
  }

  if (text === "List 10 📄") {
    try {
      const files = await driveList(env, 10);
      const lines = files.map((f, i) =>
        `${i + 1}. ${f.name}\n🕒 ${new Date(f.modifiedTime).toLocaleString("uk-UA")}\n🔗 ${f.webViewLink}`
      );
      return { text: "Останні 10 файлів:\n\n" + lines.join("\n\n") };
    } catch (e) {
      return { text: "❌ Помилка Drive list: " + String(e?.message || e) };
    }
  }

  if (text === "Checklist ➕") {
    return {
      text: "Надішли *один рядок*, який додати в `senti_checklist.md`.",
      expect: { mode: "append-checklist" },
    };
  }

  if (text === "Backup URL ⬆️") {
    return {
      text: "Надішли URL для збереження у Drive. Можна додати назву після пробілу:\n`https://... файл.zip`",
      expect: { mode: "backup-url" },
    };
  }

  return null;
}