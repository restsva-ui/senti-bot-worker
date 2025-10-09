// src/routes/user.js
import { TG } from "../lib/tg.js";
import { getUserTokens } from "../lib/userDrive.js";
import { setDriveMode, getDriveMode } from "../services/state.js";
import { handleIncomingMedia } from "../services/media.js";

// Кнопки
export const BTN_DRIVE = "Google Drive";
export const BTN_SENTI = "Senti";
export const BTN_ADMIN = "Admin";

export function mainKeyboard(isAdmin=false){
  const rows = [
    [{ text: BTN_DRIVE }, { text: BTN_SENTI }],
  ];
  if (isAdmin) rows.push([{ text: BTN_ADMIN }]);
  return { keyboard: rows, resize_keyboard: true, one_time_keyboard: false };
}
export function inlineOpenDrive(){
  return { inline_keyboard: [[{ text: "Відкрити Диск", url: "https://drive.google.com/drive/my-drive" }]] };
}

export const handleUserCommand = async ({
  env, msg, text, chatId, userId, TG, getUserTokens, userListFiles, userSaveUrl
}) => {
  // Натиснута кнопка "Google Drive"
  if (text === BTN_DRIVE) {
    const ut = await getUserTokens(env, userId);
    if (!ut?.refresh_token) {
      const authUrl = `https://${env.SERVICE_HOST}/auth/start?u=${userId}`;
      await TG.text(
        chatId,
        `Дай доступ до свого Google Drive:\n${authUrl}\n\nПісля дозволу повернись у чат і ще раз натисни «${BTN_DRIVE}».`,
        { token: env.BOT_TOKEN }
      );
      return true;
    }
    await setDriveMode(env, userId, true);
    await TG.text(
      chatId,
      "📁 Режим диска: ON\nНадсилай фото/відео/документи — збережу на твій Google Drive.",
      { token: env.BOT_TOKEN, reply_markup: mainKeyboard(false) }
    );
    await TG.text(chatId, "Переглянути вміст диска:", { token: env.BOT_TOKEN, reply_markup: inlineOpenDrive() });
    return true;
  }

  // Натиснута кнопка "Senti"
  if (text === BTN_SENTI) {
    await setDriveMode(env, userId, false);
    await TG.text(
      chatId,
      "Режим диска вимкнено. Це звичайний чат Senti.",
      { token: env.BOT_TOKEN, reply_markup: mainKeyboard(false) }
    );
    return true;
  }

  // Короткі user-команди (залишили мінімум)
  if (text === "/my_files") {
    const { userListFiles } = await import("../lib/userDrive.js");
    const files = await userListFiles(env, userId);
    const names = (files.files||[]).map(f=>`• ${f.name}`).join("\n") || "порожньо";
    await TG.text(chatId, `Твої файли:\n${names}`, { token: env.BOT_TOKEN });
    return true;
  }

  if (text.startsWith("/save_url")) {
    const { userSaveUrl } = await import("../lib/userDrive.js");
    const parts = text.split(/\s+/);
    const fileUrl = parts[1];
    const name = parts.slice(2).join(" ") || "from_telegram.bin";
    if(!fileUrl){
      await TG.text(chatId, "Використання: /save_url <url> <опц.назва>", { token: env.BOT_TOKEN });
      return true;
    }
    const f = await userSaveUrl(env, userId, fileUrl, name);
    await TG.text(chatId, `✅ Збережено: ${f.name}`, { token: env.BOT_TOKEN });
    return true;
  }

  if (text === "/ping") {
    await TG.text(chatId, "🔔 Pong! Я на зв'язку.", { token: env.BOT_TOKEN });
    return true;
  }

  return false; // не оброблено — хай індекс спробує авто-збереження або дефолт
};

export const tryAutoSaveMedia = async ({ env, msg, chatId, userId, TG, userSaveUrl }) => {
  try {
    const mode = await getDriveMode(env, userId);
    if (mode) {
      const handled = await handleIncomingMedia(env, chatId, userId, msg, TG, userSaveUrl);
      if (handled) return true;
    }
  } catch (e) {
    console.log("Media save (mode) error:", e);
    try { await TG.text(chatId, `❌ Не вдалось зберегти вкладення: ${String(e)}`, { token: env.BOT_TOKEN }); } catch {}
    return true;
  }
  return false;
};