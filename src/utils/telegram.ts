// Утиліти Telegram API. Без сторонніх бібліотек.
export interface EnvLike {
  BOT_TOKEN: string;
}

const JSON_HEADERS = { "content-type": "application/json;charset=UTF-8" } as const;

export async function tgSendMessage(env: EnvLike, chatId: number, text: string) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  const body = { chat_id: chatId, text, parse_mode: "Markdown" };
  await fetch(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
}

export async function tgGetFilePath(env: EnvLike, fileId: string): Promise<string | null> {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/getFile`;
  const res = await fetch(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ file_id: fileId }) });
  const data = await res.json<any>().catch(() => ({}));
  return data?.ok && data?.result?.file_path ? String(data.result.file_path) : null;
}

export type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: "private" | "group" | "supergroup" | "channel" };
    text?: string;
    photo?: { file_id: string; width: number; height: number; file_unique_id: string }[];
  };
};