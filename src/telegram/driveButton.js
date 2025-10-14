// src/telegram/driveButton.js
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { setDriveMode } from "./state.js";
import { tr } from "../lib/i18n.js";
import { sendMessage } from "./helpers.js";
import { inlineOpenDrive } from "./ui.js";

export async function handleDriveButton({ env, chatId, userId, lang }) {
  const ut = await getUserTokens(env, userId);
  if (!ut?.refresh_token) {
    const authUrl = abs(env, `/auth/start?u=${userId}`);
    await sendMessage(env, chatId, tr(lang, "drive_auth", authUrl));
    return;
  }
  await setDriveMode(env, userId, true);
  await sendMessage(env, chatId, "\u2060", { reply_markup: inlineOpenDrive() });
}
