// src/telegram/ui.js
import { abs } from "../utils/url.js";

export const BTN_DRIVE = "📁 Drive";
export const BTN_SENTI = "🧠 Senti";
export const BTN_ADMIN = "🔧 Admin";

export const mainKeyboard = (isAdmin = false) => {
  const rows = [[{ text: BTN_DRIVE }, { text: BTN_SENTI }]];
  if (isAdmin) rows.push([{ text: BTN_ADMIN }]);
  return { keyboard: rows, resize_keyboard: true };
};

export const inlineOpenDrive = () => ({
  inline_keyboard: [[{ text: "Google Drive", url: "https://drive.google.com/drive/my-drive" }]],
});

export function energyLinks(env, userId) {
  const s = env.WEBHOOK_SECRET || "";
  const qs = `s=${encodeURIComponent(s)}&u=${encodeURIComponent(String(userId || ""))}`;
  return {
    energy: abs(env, `/admin/energy/html?${qs}`),
    checklist: abs(env, `/admin/checklist/html?${qs}`),
  };
}

export const ADMIN = (env, userId) => String(userId) === String(env.TELEGRAM_ADMIN_ID);
