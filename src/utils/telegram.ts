// src/utils/telegram.ts
import type { Env } from "../index";

type SendOptions = {
  parse_mode?: "Markdown" | "HTML";
  disable_web_page_preview?: boolean;
  reply_markup?: unknown;
};

/**
 * Надсилання текстового повідомлення у Telegram.
 * Використовує API_BASE_URL і BOT_TOKEN з env.
 */
export async function sendMessage(
  env: Env,
  chatId: number,
  text: string,
  opts: SendOptions = {}
) {
  const url = `${env.API_BASE_URL}/bot${env.BOT_TOKEN}/sendMessage`;

  const body = {
    chat_id: chatId,
    text,
    parse_mode: opts.parse_mode ?? "Markdown",
    disable_web_page_preview: opts.disable_web_page_preview ?? true,
    reply_markup: opts.reply_markup,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const msg = await safeText(res);
    throw new Error(`sendMessage failed: ${res.status} ${msg}`);
  }
}

async function safeText(res: Response) {
  try {
    return await res.text();
  } catch {
    return "<no-body>";
  }
}