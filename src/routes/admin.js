// Адмін-меню та обробники кнопок
import { drivePing, driveList, driveSaveFromUrl, driveAppendLog } from "../lib/drive.js";
import { getState, setState, clearState } from "../utils/state.js";
import { sendMessage, escape } from "../utils/telegram.js";

export function adminKeyboard() {
  // IMPORTANT: keyboard — це масив РЯДКІВ (масив масивів)
  return {
    keyboard: [
      [{ text: "Drive ✅" }, { text: "List 10 🧾" }],
      [{ text: "Backup URL ⬆️" }, { text: "Checklist +" }],
      [{ text: "Меню" }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

export async function showAdminMenu(env, chatId) {
  // скидаємо будь-який “очікую URL”
  await clearState(env, chatId, "awaiting_url");
  return sendMessage(env, chatId,
    "Senti Admin\n— мінімальне меню керування:\n• Drive пінг і список файлів\n• Швидкий бекап за URL\n• Додавання в чеклист",
    { reply_markup: adminKeyboard() }
  );
}

export async function handleAdminButtons(env, chatId, text) {
  const trimmed = (text || "").trim();

  if (trimmed === "Drive ✅") {
    // скинути очікування URL, якщо було
    await clearState(env, chatId, "awaiting_url");
    try {
      await drivePing(env);
      return sendMessage(env, chatId, "🟢 Drive доступний");
    } catch (e) {
      return sendMessage(env, chatId, `🔴 Drive помилка: ${escape(e.message)}`);
    }
  }

  if (trimmed === "List 10 🧾") {
    await clearState(env, chatId, "awaiting_url");
    try {
      const files = await driveList(env, 10);
      if (!files.length) return sendMessage(env, chatId, "Порожньо.");
      const lines = files.map(
        (f, i) => `${i + 1}. ${escape(f.name)} — ${escape(f.webViewLink || f.id)}`
      );
      return sendMessage(env, chatId, lines.join("\n"));
    } catch (e) {
      return sendMessage(env, chatId, `Не вдалося отримати список: ${escape(e.message)}`);
    }
  }

  if (trimmed === "Backup URL ⬆️") {
    // ставимо стан очікування URL
    await setState(env, chatId, "awaiting_url", true);
    return sendMessage(env, chatId,
      "Надішли URL для збереження у Drive.\nМожна додати назву після пробілу: `https://... файл.zip`",
      { parse_mode: "Markdown" }
    );
  }

  if (trimmed === "Checklist +") {
    await setState(env, chatId, "awaiting_checklist_line", true);
    return sendMessage(env, chatId, "Надішли рядок, який додати до `senti_checklist.md`", {
      parse_mode: "Markdown",
    });
  }

  if (trimmed === "Меню") {
    await clearState(env, chatId, "awaiting_url");
    await clearState(env, chatId, "awaiting_checklist_line");
    // покажемо підказки за замовчуванням (звичайне меню)
    return sendMessage(env, chatId,
      "Доступні команди:\n/start — запустити бота\n/menu — адмін-меню\n/ping — перевірка зв'язку"
    );
  }

  // Якщо користувач у стані “очікую URL” — пробуємо зберегти
  const isAwaitingUrl = await getState(env, chatId, "awaiting_url");
  if (isAwaitingUrl) {
    const parts = trimmed.split(/\s+(.+)?/); // URL [name?]
    const url = parts[0];
    const name = parts[1] || "";
    if (!/^https?:\/\//i.test(url)) {
      return sendMessage(env, chatId, "Надішли, будь ласка, валідний URL (http/https).");
    }
    try {
      const saved = await driveSaveFromUrl(env, url, name);
      await clearState(env, chatId, "awaiting_url");
      return sendMessage(env, chatId, `✅ Збережено: ${escape(saved.name)}\n${escape(saved.link)}`);
    } catch (e) {
      return sendMessage(env, chatId, `Помилка збереження: ${escape(e.message)}`);
    }
  }

  // Якщо користувач у стані “очікую рядок для чеклисту”
  const isAwaitingLine = await getState(env, chatId, "awaiting_checklist_line");
  if (isAwaitingLine) {
    const line = trimmed;
    if (!line) return sendMessage(env, chatId, "Надішли не порожній рядок.");
    try {
      await driveAppendLog(env, "senti_checklist.md", line);
      await clearState(env, chatId, "awaiting_checklist_line");
      return sendMessage(env, chatId, "✅ Додано до чеклисту.");
    } catch (e) {
      return sendMessage(env, chatId, `Помилка: ${escape(e.message)}`);
    }
  }

  // Невідома кнопка — повернемось до меню
  return showAdminMenu(env, chatId);
}