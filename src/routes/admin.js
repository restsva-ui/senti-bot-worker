// src/routes/admin.js
import { adminKeyboard } from "../lib/keyboard.js";
import { drivePing, driveListLatest } from "../lib/drive.js";

/** Команда, яка відкриває адмін-меню */
export function wantAdmin(text = "") {
  const t = String(text || "").trim().toLowerCase();
  return t === "/admin" || t === "меню" || t === "/menu";
}

/** Нормалізація: нижній регістр, прибираємо емодзі/службові символи, стискаємо пробіли */
function norm(s = "") {
  const str = String(s || "")
    // прибрати emoji та піктограми
    .replace(/\p{Extended_Pictographic}/gu, " ")
    // прибрати керівні/непомітні символи
    .replace(/[\u2000-\u200F\u202A-\u202E\u2060-\u206F]/g, " ")
    // замінити підряд пробілів одним
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return str;
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
  const t = norm(tRaw);

  // 1) Просто показати меню
  if (wantAdmin(tRaw) || t === "меню") {
    return {
      text:
        "Senti Admin\n— мінімальне меню керування:\n" +
        "• Drive пінг і список файлів\n" +
        "• Швидкий бекап за URL\n" +
        "• Додавання в чеклист",
      keyboard: adminKeyboard(),
    };
  }

  // 2) Кнопки з клавіатури: робимо нечутливими до емодзі/регістру/зайвих пробілів
  // Drive ping
  if (t.startsWith("drive") || t === "drive" || t.includes("gdrive ping") || t === "/gdrive_ping_btn") {
    try {
      await drivePing(env);
      return { text: "🟢 Drive OK", keyboard: adminKeyboard() };
    } catch (e) {
      return { text: "🔴 Drive помилка: " + String(e?.message || e), keyboard: adminKeyboard() };
    }
  }

  // List 10
  if (t.startsWith("list 10") || t === "list 10" || t === "/list10_btn") {
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

  // Backup URL
  if (t.startsWith("backup url") || t === "backup url" || t === "/backup_btn") {
    return {
      text: "Надішли URL для збереження у Drive. Можна додати назву після пробілу:\n`https://... файл.zip`",
      expect: "backup-url",
      keyboard: adminKeyboard(),
    };
  }

  // Checklist add
  if (t.startsWith("checklist") || t === "checklist" || t.includes("checklist add") || t === "/checklist_add_btn") {
    return {
      text: "Надішли *один рядок*, який додати в `senti_checklist.md`.",
      expect: "append-checklist",
      keyboard: adminKeyboard(),
    };
  }

  // Якщо не впізнали — повертаємо null, щоб webhook проігнорував
  return null;
}