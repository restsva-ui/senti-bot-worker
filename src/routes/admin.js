// Адмін-панель: кнопки + слеши + діалоги
import { drivePing, driveList, driveSaveFromUrl, driveAppendLog } from "../lib/drive.js";
import { getState, setState, clearState } from "../lib/state.js";
import { adminKeyboard } from "../lib/keyboard.js";

const norm = (t) =>
  (t || "")
    .replace(/[\uFE0F]/g, "")
    .replace(/[\p{Extended_Pictographic}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

async function send(env, chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", ...extra }),
  }).catch(() => {});
}

// ——— Системні команди Telegram (видно в меню) ———
export async function ensureBotCommands(env) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/setMyCommands`;
  const commands = [
    { command: "admin", description: "Адмін-панель (Drive/Backup/Checklist)" },
    { command: "menu", description: "Відкрити адмін-панель" },
    { command: "help", description: "Довідка" },
    { command: "ping", description: "Перевірка зв'язку" },
  ];
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commands }),
    });
  } catch {}
}

export function wantAdmin(normText) {
  return normText === "/admin" || normText === "/menu" || normText === "меню";
}

function fmtTime(ts, env) {
  try { return new Date(ts).toLocaleString("uk-UA", { timeZone: env.TZ || "Europe/Kyiv", hour12: false }); }
  catch { return ts; }
}

async function showPanel(env, chatId) {
  await send(
    env,
    chatId,
    [
      "*Senti Admin*",
      "— мінімальне меню керування:",
      "• Drive пінг і список файлів",
      "• Швидкий бекап за URL",
      "• Додавання в чеклист",
    ].join("\n"),
    { reply_markup: adminKeyboard() }
  );
}

async function showDrive(env, chatId) {
  try {
    await drivePing(env);
    await send(env, chatId, "🟢 Drive OK", { reply_markup: adminKeyboard() });
  } catch (e) {
    await send(env, chatId, "🔴 Drive помилка: " + String(e?.message || e), { reply_markup: adminKeyboard() });
    return;
  }

  try {
    const files = await driveList(env, 10);
    const lines = files.map((f, i) => {
      const when = f.modifiedTime ? fmtTime(f.modifiedTime, env) : "";
      const link = f.webViewLink || `https://drive.google.com/file/d/${f.id}/view?usp=drivesdk`;
      return `${i + 1}. *${f.name}*\n🕒 ${when}\n🔗 ${link}`;
    });
    await send(env, chatId, ["*Останні 10 файлів:*", ...lines].join("\n\n"), { reply_markup: adminKeyboard() });
  } catch (e) {
    await send(env, chatId, "⚠️ Не вдалося отримати список файлів: " + String(e?.message || e), {
      reply_markup: adminKeyboard(),
    });
  }
}

export async function handleAdminCommand({ env, update, chatId, text, norm: ntext, state }) {
  // Показ панелі
  if (wantAdmin(ntext) || ntext === "/start") {
    await showPanel(env, chatId);
    return true;
  }

  // Обробка стадій діалогу (очікуємо URL чи рядок для чеклиста)
  if (state?.type === "await_backup_url") {
    const m = text.match(/^(https?:\/\/\S+)(?:\s+(.+))?$/i);
    if (!m) {
      await send(env, chatId, "❗️Це не схоже на URL. Спробуй ще раз: `https://... [назва]`");
      return true;
    }
    const url = m[1];
    const name = (m[2] || "").trim();
    try {
      const saved = await driveSaveFromUrl(env, url, name);
      await send(env, chatId, `✅ Збережено: *${saved.name}*\n🔗 ${saved.link}`, { reply_markup: adminKeyboard() });
      try { await driveAppendLog(env, "senti_checklist.md", `Backup: ${saved.name} — ${saved.link}`); } catch {}
    } catch (e) {
      await send(env, chatId, "❌ Не вдалося зберегти: " + String(e?.message || e));
    }
    await clearState(env, chatId);
    return true;
  }

  if (state?.type === "await_checklist_line") {
    const line = (text || "").replace(/\s+/g, " ").trim();
    if (!line) {
      await send(env, chatId, "❗️Надішли *один* непорожній рядок.");
      return true;
    }
    try {
      const r = await driveAppendLog(env, "senti_checklist.md", line);
      await send(env, chatId, `🟩 Додано в *senti_checklist.md*.\n🔗 ${r.webViewLink}`, {
        reply_markup: adminKeyboard(),
      });
    } catch (e) {
      await send(env, chatId, "❌ Помилка при додаванні: " + String(e?.message || e));
    }
    await clearState(env, chatId);
    return true;
  }

  // Кнопки / короткі команди
  if (["drive ✅", "drive"].includes(ntext) || ntext === "/drive") {
    await showDrive(env, chatId);
    return true;
  }

  if (["list 10", "list 10 📄", "list10", "/list10"].includes(ntext)) {
    // просто делегуємо на showDrive (він і так показує список після пінгу)
    await showDrive(env, chatId);
    return true;
  }

  if (["backup url", "backup url ⬆️", "/backup"].includes(ntext)) {
    await setState(env, chatId, { type: "await_backup_url" });
    await send(
      env,
      chatId,
      "Надішли *URL* для збереження у Drive. Можна додати назву після пробілу:\n`https://... файл.zip`",
      { reply_markup: adminKeyboard() }
    );
    return true;
  }

  if (["checklist", "checklist +", "checklist ➕", "/checkadd"].includes(ntext)) {
    await setState(env, chatId, { type: "await_checklist_line" });
    await send(env, chatId, "Надішли *один рядок*, який додати в *senti_checklist.md*.", {
      reply_markup: adminKeyboard(),
    });
    return true;
  }

  return false; // не ми
}