// Телеграм API: тільки те, що нам потрібно зараз
import { CFG } from "../config";

type ReplyMarkup = {
  inline_keyboard: { text: string; callback_data: string }[][];
};

export async function sendMessage(
  chatId: number,
  text: string,
  replyMarkup?: ReplyMarkup
) {
  const cfg = CFG();
  const url = `${cfg.apiBase}/bot${cfg.botToken}/sendMessage`;
  const body: any = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

export async function answerCallbackQuery(callbackQueryId: string) {
  const cfg = CFG();
  const url = `${cfg.apiBase}/bot${cfg.botToken}/answerCallbackQuery`;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  }).catch(() => {});
}