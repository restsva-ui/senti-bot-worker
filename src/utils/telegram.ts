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
    parse_mode: extra?.parse_mode ?? "Markdown",
    ...extra,
  };
  await fetch(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
}

/** Зібрати повний URL до файлу Telegram з file_path */
export function tgBuildFileUrl(env: EnvLike, filePath: string): string {
  return `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`;
}

/**
 * Надійне отримання file_path з Telegram Bot API.
 * 1) GET /getFile?file_id=...
 * 2) POST (x-www-form-urlencoded)
 * 3) POST (JSON)
 * Повертає `null`, якщо не вдалося отримати шлях.
 */
export async function tgGetFilePath(env: EnvLike, fileId: string): Promise<string | null> {
  // 1) GET
  try {
    const getUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${encodeURIComponent(
      fileId
    )}`;
    const res = await fetch(getUrl, { method: "GET" });
    const data = await res.json<any>().catch(() => ({}));
    console.log("🔍 TG getFile (GET) =>", res.status, data?.ok ?? null);
    if (data?.ok && data?.result?.file_path) {
      return String(data.result.file_path);
    }
  } catch (e: any) {
    console.log("⚠️ TG getFile (GET) error:", e?.message || String(e));
  }

  // 2) POST (x-www-form-urlencoded)
  try {
    const postUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/getFile`;
    const res = await fetch(postUrl, {
      method: "POST",
      headers: FORM_HEADERS,
      body: new URLSearchParams({ file_id: fileId }),
    });
    const data = await res.json<any>().catch(() => ({}));
    console.log("🔍 TG getFile (POST form) =>", res.status, data?.ok ?? null);
    if (data?.ok && data?.result?.file_path) {
      return String(data.result.file_path);
    }
  } catch (e: any) {
    console.log("⚠️ TG getFile (POST form) error:", e?.message || String(e));
  }

  // 3) POST (JSON)
  try {
    const postUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/getFile`;
    const res = await fetch(postUrl, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ file_id: fileId }),
    });
    const data = await res.json<any>().catch(() => ({}));
    console.log("🔍 TG getFile (POST json) =>", res.status, data?.ok ?? null);
    if (data?.ok && data?.result?.file_path) {
      return String(data.result.file_path);
    }
  } catch (e: any) {
    console.log("⚠️ TG getFile (POST json) error:", e?.message || String(e));
  }

  console.log("❌ TG getFile: failed to resolve file_path for", fileId);
  return null;
}

/** Зручний хелпер: повертає готовий URL до файлу або null */
export async function tgGetFileUrl(env: EnvLike, fileId: string): Promise<string | null> {
  const path = await tgGetFilePath(env, fileId);
  return path ? tgBuildFileUrl(env, path) : null;
}

/** Витягнути найкращий file_id фото з апдейта (найбільша роздільна здатність) */
export function tgPickBestPhotoFileId(update: TgUpdate | any): string | null {
  const photos: Array<{ file_id: string; width: number; height: number }> | undefined =
    update?.message?.photo ??
    update?.edited_message?.photo ??
    update?.channel_post?.photo ??
    update?.callback_query?.message?.photo;

  if (!photos?.length) return null;
  const best = [...photos].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  return best?.file_id || null;
}

/** Тип для апдейтів — базовий мінімум, розширений для фото/доків */
export type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: "private" | "group" | "supergroup" | "channel" };
    from?: { id: number; language_code?: string };
    text?: string;
    caption?: string;
    photo?: { file_id: string; width: number; height: number; file_unique_id: string }[];
    document?: {
      file_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
      thumb?: { file_id: string; width: number; height: number };
    };
    reply_to_message?: {
      message_id: number;
      photo?: { file_id: string; width: number; height: number; file_unique_id: string }[];
      document?: { file_id: string };
      caption?: string;
      text?: string;
    };
  };
  edited_message?: TgUpdate["message"];
  channel_post?: TgUpdate["message"];
  callback_query?: {
    id: string;
    from?: { id: number; language_code?: string };
    data?: string;
    message?: TgUpdate["message"];
  };
};