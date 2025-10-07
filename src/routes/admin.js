// Адмін-модуль
import { adminKeyboard } from "../lib/index.js"; // <- лише з index.js
import { driveList, driveAppendLog } from "../lib/drive.js"; // якщо вже є у drive.js

export async function handleAdminCommand(env, chatId, text) {
  // стартове повідомлення адмінки
  if (text === "/admin") {
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
    // простий пінг, можна реюзнути drivePing, якщо є
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
    // перемикаємо діалог у режим очікування рядка для чеклиста
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