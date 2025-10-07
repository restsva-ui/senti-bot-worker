// src/routes/admin.js
import { adminKeyboard } from "../lib/keyboard.js";
import { drivePing, driveListLatest } from "../lib/drive.js";

/** Команда, яка відкриває адмін-меню */
export function wantAdmin(text = "") {
  const t = String(text || "").trim().toLowerCase();
  return t === "/admin" || t === "меню" || t === "/menu";
}

/** Зареєструвати команди бота в Telegram (щоб були в системному меню) */
export async function ensureBotCommands(env) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/setMyCommands`;
  const commands = [
    { command: "start", description: "Запустити бота" },
    { command: "admin", description: "Адмін-меню (керування)" },
    { command: "menu", description: "Показати меню" },
    { command: "ping", description: "Перевірка зв'язку" },
    { command: "help", description: "Довідка" },
  ];
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commands }),
    });
  } catch (_) {}
}

/**
 * Обробка адмін-команд і кнопок.
 * Повертає:
 *  - { text, keyboard } — повідомлення + клавіатура
 *  - { text, expect: 'backup-url'|'append-checklist', keyboard? } — якщо чекаємо наступний крок
 */
export async function handleAdminCommand(env, chatId, text) {
  const tRaw = String(text || "").trim();
  const t = tRaw.toLowerCase();

  // 1) Просто показати меню
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

  // 2) Кнопки з клавіатури (підписи повинні збігатися з adminKeyboard())
  if (tRaw === "Drive ✅" || t === "/gdrive_ping_btn") {
    try {
      await drivePing(env);
      return { text: "🟢 Drive OK", keyboard: adminKeyboard() };
    } catch (e) {
      return { text: "🔴 Drive помилка: " + String(e?.message || e), keyboard: adminKeyboard() };
    }
  }

  if (tRaw === "List 10 🧾" || t === "list 10" || t === "/list10_btn") {
    try {
      const list = await driveListLatest(env, 10); // [{name, webViewLink, modifiedTime}]
      if (!list?.length) {
        return { text: "Список порожній.", keyboard: adminKeyboard() };
      }
      const lines = list.map((f, i) => {
        const dt = new Date(f.modifiedTime || Date.now());
        const time = dt.toISOString().replace("T", " ").replace("Z", "");
        return [
          `${i + 1}. *${f.name}*`,
          `🕓 ${time}`,
          f.webViewLink ? `🔗 ${f.webViewLink}` : "",
        ].filter(Boolean).join("\n");
      });
      return { text: "Останні 10 файлів:\n\n" + lines.join("\n\n"), keyboard: adminKeyboard() };
    } catch (e) {
      return { text: "Не вдалося отримати список: " + String(e?.message || e), keyboard: adminKeyboard() };
    }
  }

  if (tRaw === "Backup URL ⬆️" || t === "/backup_btn") {
    return {
      text: "Надішли URL для збереження у Drive. Можна додати назву після пробілу:\n`https://... файл.zip`",
      expect: "backup-url",
      keyboard: adminKeyboard(),
    };
  }

  if (tRaw === "Checklist ➕" || t === "/checklist_add_btn") {
    return {
      text: "Надішли *один рядок*, який додати в `senti_checklist.md`.",
      expect: "append-checklist",
      keyboard: adminKeyboard(),
    };
  }

  // Якщо не впізнали — повертаємо null, щоб хендлер у webhook.js проігнорував
  return null;
}