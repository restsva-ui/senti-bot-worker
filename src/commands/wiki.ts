import type { TgUpdate } from "../types";

async function tgCall(
  env: { BOT_TOKEN: string; API_BASE_URL?: string },
  method: string,
  payload: Record<string, unknown>
) {
  const api = env.API_BASE_URL || "https://api.telegram.org";
  const res = await fetch(`${api}/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("tgCall error", method, res.status, t);
  }
  return res.json().catch(() => ({}));
}

function detectLang(code?: string, text?: string) {
  const t = (text || "").toLowerCase();
  if (code && ["uk", "en", "ru", "de", "fr"].includes(code.slice(0,2))) return code.slice(0,2);
  if (/[а-яіїєґ]/i.test(t)) {
    if (/[ієїґ]/i.test(t)) return "uk";
    return "ru";
  }
  if (/[äöüß]/i.test(t)) return "de";
  if (/[àâçéèêëîïôùûüÿœæ]/i.test(t)) return "fr";
  return "en";
}

function extractArg(text: string) {
  const m = text.trim().match(/^\/\w+\s*(.*)$/);
  return (m?.[1] || "").trim();
}

function escapeHtml(s: string) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}

export const wikiCommand = {
  name: "wiki",
  description: "Пошук у Вікі. /wiki <запит> або натисніть Wiki у меню і надішліть запит у відповідь",
  async execute(env: { BOT_TOKEN: string; API_BASE_URL?: string }, update: TgUpdate) {
    const chatId = update.message?.chat?.id;
    const text = update.message?.text || "";
    if (!chatId) return;

    const arg = extractArg(text);
    if (arg) {
      const lang = detectLang(update.message?.from?.language_code, arg);
      const reply = [
        `🔎 <b>Wiki (${lang})</b>`,
        `Запит: <i>${escapeHtml(arg)}</i>`,
        "",
        "Демо-відповідь: (тут мав би бути реальний результат пошуку)",
      ].join("\n");
      await tgCall(env, "sendMessage", { chat_id: chatId, text: reply, parse_mode: "HTML" });
      return;
    }

    await tgCall(env, "sendMessage", {
      chat_id: chatId,
      text: "✍️ Введіть запит для Wiki у наступному повідомленні (відповіддю).",
      reply_markup: { force_reply: true, selective: true },
    });
  },
} as const;

/** Якщо прийшов текст-відповідь на наш prompt — це запит до Wiki */
export function wikiMaybeHandleFreeText(
  env: { BOT_TOKEN: string; API_BASE_URL?: string },
  update: TgUpdate
) {
  const msg = update.message;
  if (!msg?.text) return false;
  const isReplyToBot = !!msg.reply_to_message?.from?.is_bot;
  const repliedText = msg.reply_to_message?.text || "";
  if (!isReplyToBot) return false;
  if (!/Введіть запит|Напишіть ваш запит|Write your wiki query|Запрос для Wiki/i.test(repliedText)) {
    return false;
  }
  const lang = detectLang(msg.from?.language_code, msg.text);
  const reply = [
    `🔎 <b>Wiki (${lang})</b>`,
    `Запит: <i>${escapeHtml(msg.text)}</i>`,
    "",
    "Демо-відповідь: (тут мав би бути реальний результат пошуку)",
  ].join("\n");
  tgCall(env, "sendMessage", { chat_id: msg.chat.id, text: reply, parse_mode: "HTML" });
  return true;
}