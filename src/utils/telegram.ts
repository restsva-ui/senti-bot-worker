// src/utils/telegram.ts
// Утиліти Telegram API. Без сторонніх бібліотек.

export interface EnvLike {
  BOT_TOKEN: string;
}

const JSON_HEADERS = { "content-type": "application/json;charset=UTF-8" } as const;
const FORM_HEADERS = { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" } as const;

/** Простий відправник повідомлень */
export async function tgSendMessage(
  env: EnvLike,
  chatId: number,
  text: string,
  extra?: Partial<{
    parse_mode: "Markdown" | "HTML" | "MarkdownV2";
    reply_to_message_id: number;
    disable_web_page_preview: boolean;
  }>
) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    ...extra,
  };
  await fetch(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
}

/**
 * Надійне отримання file_path з Telegram Bot API.
 * 1) Пробуємо офіційний GET /getFile?file_id=...
 * 2) Якщо не вдалось — POST form-urlencoded
 * 3) Як останній шанс — POST із JSON (деякі проксі все ж приймають)
 */
export async function tgGetFilePath(env: EnvLike, fileId: string): Promise<string | null> {
  // 1) GET
  try {
    const getUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`;
    const res = await fetch(getUrl, { method: "GET" });
    const data = await res.json<any>().catch(() => ({}));
    if (data?.ok && data?.result?.file_path) {
      return String(data.result.file_path);
    }
  } catch { /* ignore and fallback */ }

  // 2) POST (x-www-form-urlencoded)
  try {
    const postUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/getFile`;
    const res = await fetch(postUrl, {
      method: "POST",
      headers: FORM_HEADERS,
      body: new URLSearchParams({ file_id: fileId }),
    });
    const data = await res.json<any>().catch(() => ({}));
    if (data?.ok && data?.result?.file_path) {
      return String(data.result.file_path);
    }
  } catch { /* ignore and fallback */ }

  // 3) POST (JSON) — останній фолбек
  try {
    const postUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/getFile`;
    const res = await fetch(postUrl, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ file_id: fileId }),
    });
    const data = await res.json<any>().catch(() => ({}));
    if (data?.ok && data?.result?.file_path) {
      return String(data.result.file_path);
    }
  } catch { /* ignore */ }

  return null;
}

/** Тип для апдейтів — базовий мінімум, який нам потрібен */
export type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: "private" | "group" | "supergroup" | "channel" };
    text?: string;
    photo?: { file_id: string; width: number; height: number; file_unique_id: string }[];
  };
};