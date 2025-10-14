// [1/7] src/routes/webhook/utils.js
import { abs } from "../../utils/url.js";

// Кнопки
export const BTN_DRIVE = "Google Drive";
export const BTN_SENTI = "Senti";
export const BTN_ADMIN = "Admin";
export const BTN_CHECK = "Checklist";

export const mainKeyboard = (isAdmin = false) => {
  const rows = [[{ text: BTN_DRIVE }, { text: BTN_SENTI }]];
  if (isAdmin) rows.push([{ text: BTN_ADMIN }, { text: BTN_CHECK }]);
  return { keyboard: rows, resize_keyboard: true };
};

export const inlineOpenDrive = () => ({
  inline_keyboard: [[{ text: "Відкрити Диск", url: "https://drive.google.com/drive/my-drive" }]],
});

export const ADMIN = (env, userId) => String(userId) === String(env.TELEGRAM_ADMIN_ID);

// /ai (підтримує /ai, /ai@Bot, з/без аргументів)
export function parseAiCommand(text = "") {
  const s = String(text).trim();
  const m = s.match(/^\/ai(?:@[\w_]+)?(?:\s+([\s\S]+))?$/i);
  if (!m) return null;
  return (m[1] || "").trim();
}

export const isBlank = (s) => !s || !String(s).trim();

export function defaultAiReply() {
  return (
    "🤖 Я можу відповідати на питання, допомагати з кодом, " +
    "зберігати файли на Google Drive (кнопка «Google Drive») " +
    "та керувати чеклистом/репозиторієм. Спробуй запит на тему, яка цікавить!"
  );
}

// Посилання для керування енергією/чеклістом
export function energyLinks(env, userId) {
  const s = env.WEBHOOK_SECRET || "";
  const qs = `s=${encodeURIComponent(s)}&u=${encodeURIComponent(String(userId || ""))}`;
  return {
    energy: abs(env, `/admin/energy/html?${qs}`),
    checklist: abs(env, `/admin/checklist/html?${qs}`),
  };
}