// src/routes/admin.js
// Адмін-меню та дії

import { drivePing, driveList, driveSaveFromUrl, driveAppendLog } from "../lib/drive.js";
import { getState, setState, clearState } from "../lib/state.js";
import { sendMessage, escape } from "../lib/telegram.js";

export function adminKeyboard() {
  // ВАЖЛИВО: keyboard = масив рядків (масив масивів)
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
  await clearState(env, chatId, "awaiting_url");
  await clearState(env, chatId, "awaiting_checklist_line");
  return sendMessage(
    env,
    chatId,
    "Senti Admin\n— мінімальне меню керування:\n• Drive пінг і список файлів\n• Швидкий бекап за URL\n• Додавання в чеклист",
    { reply_markup: adminKeyboard() }
  );
}

export async function handleAdminButtons(env, chatId, text) {
  const t = (text || "").trim();

  if (t === "Drive ✅") {
    await clearState(env, chatId, "awaiting_url");
    try {
      await drivePing(env);
      return sendMessage(env, chatId, "🟢 Drive доступний");
    } catch (e) {
      return sendMessage(env, chatId, `🔴 Drive помилка: ${escape(e.message)}`);
    }
  }

  if (t === "List 10 🧾") {
    await clearState(env, chatId, "awaiting_url");
    try {
      const files = await driveList(env, 10);
      if (!files?.length) return sendMessage(env, chatId, "Порожньо.");
      const lines = files.map(
        (f, i) => `${i + 1}. ${escape(f.name)} — ${escape(f.webViewLink || f.id)}`
      );
      return sendMessage(env, chatId, lines.join("\n"));
    } catch (e) {
      return sendMessage(env, chatId, `Не вдалося отримати список: ${escape(e.message)}`);
    }
  }

  if (t === "Backup URL ⬆️") {
    await setState(env, chatId, "awaiting_url", true);
    return sendMessage(
      env,
      chatId,
      "Надішли URL для збереження у Drive.\nМожна додати назву після пробілу: `https://... файл.zip`",
      { parse_mode: "Markdown" }
    );
  }

  if (t === "Checklist +") {
    await setState(env, chatId, "awaiting_checklist_line", true);
    return sendMessage(env, chatId, "Надішли рядок, який додати до `senti_checklist.md`", {
      parse_mode: "Markdown",
    });
  }

  if (t === "Меню") {
    await clearState(env, chatId, "awaiting_url");
    await clearState(env, chatId, "awaiting_checklist_line");
    return sendMessage(
      env,
      chatId,
      "Доступні команди:\n/start — запустити бота\n/menu — адмін-меню\n/ping — перевірка зв'язку"
    );
  }

  // ——— СТАНИ ———
  const waitUrl = await getState(env, chatId, "awaiting_url");
  if (waitUrl) {
    const m = t.match(/^(\S+)(?:\s+(.+))?$/); // URL [name]
    const url = m?.[1] || "";
    const name = m?.[2] || "";
    if (!/^https?:\/\//i.test(url)) {
      return sendMessage(env, chatId, "Надішли, будь ласка, валідний URL (http/https).");
    }
    try {
      const saved = await driveSaveFromUrl(env, url, name);
      await clearState(env, chatId, "awaiting_url");
      return sendMessage(
        env,
        chatId,
        `✅ Збережено: ${escape(saved.name)}\n${escape(saved.link)}`
      );
    } catch (e) {
      return sendMessage(env, chatId, `Помилка збереження: ${escape(e.message)}`);
    }
  }

  const waitLine = await getState(env, chatId, "awaiting_checklist_line");
  if (waitLine) {
    if (!t) return sendMessage(env, chatId, "Надішли не порожній рядок.");
    try {
      await driveAppendLog(env, "senti_checklist.md", t);
      await clearState(env, chatId, "awaiting_checklist_line");
      return sendMessage(env, chatId, "✅ Додано до чеклисту.");
    } catch (e) {
      return sendMessage(env, chatId, `Помилка: ${escape(e.message)}`);
    }
  }

  // fallback
  return showAdminMenu(env, chatId);
}