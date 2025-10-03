// src/utils/telegram.ts
// Хелпери Telegram API для Cloudflare Workers (ESM)

export type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string; // опційно: свій endpoint
};

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const TG_MAX_LEN = 4096;

function apiBase(env: Env): string {
  const base = (env.API_BASE_URL || "https://api.telegram.org").replace(/\/+$/, "");
  return `${base}/bot${env.BOT_TOKEN}`;
}

async function tgFetch<T = any>(env: Env, method: string, body: Record<string, any>): Promise<T> {
  const url = `${apiBase(env)}/${method}`;
  const res = await fetch(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
  if (!res.ok) {
    let text = "";
    try { text = await res.text(); } catch {}
    console.error("Telegram API error:", { method, status: res.status, text });
  }
  return res.json() as Promise<T>;
}

/** Надіслати повідомлення з авто-розбиттям >4096 символів. */
export async function tgSendMessage(
  env: Env,
  chat_id: number | string,
  text: string,
  extra: Record<string, any> = {}
) {
  if ((text ?? "").length > TG_MAX_LEN) {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += TG_MAX_LEN) chunks.push(text.slice(i, i + TG_MAX_LEN));
    for (const [idx, chunk] of chunks.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await tgFetch(env, "sendMessage", { chat_id, text: (idx ? `\n(продовження ${idx + 1}/${chunks.length})\n` : "") + chunk, parse_mode: "HTML", ...extra });
    }
    return;
  }
  return tgFetch(env, "sendMessage", { chat_id, text, parse_mode: "HTML", ...extra });
}

export async function answerCallbackQuery(env: Env, callback_query_id: string, text = "", show_alert = false) {
  return tgFetch(env, "answerCallbackQuery", { callback_query_id, text, show_alert });
}

export async function editMessageText(
  env: Env,
  chat_id: number | string,
  message_id: number,
  text: string,
  extra: Record<string, any> = {}
) {
  return tgFetch(env, "editMessageText", { chat_id, message_id, text, parse_mode: "HTML", ...extra });
}

export async function getFile(env: Env, file_id: string) {
  return tgFetch<{ ok: boolean; result?: { file_path?: string } }>(env, "getFile", { file_id });
}

/** Direct URL до файлу на основі getFile. */
export async function tgGetFileUrl(file_id: string, env: Env): Promise<string> {
  const info = await getFile(env, file_id);
  const file_path = info?.result?.file_path || "";
  if (!file_path) throw new Error("tgGetFileUrl: empty file_path");
  const base = (env.API_BASE_URL || "https://api.telegram.org").replace(/\/+$/, "");
  return `${base}/file/bot${env.BOT_TOKEN}/${file_path}`;
}

/** --- Команди бота --- */
export async function setMyCommands(
  env: Env,
  commands: Array<{ command: string; description: string }>,
  scope?: Record<string, any>,
  language_code?: string
) {
  const body: any = { commands };
  if (scope) body.scope = scope;
  if (language_code) body.language_code = language_code;
  return tgFetch(env, "setMyCommands", body);
}

export async function deleteMyCommands(
  env: Env,
  scope?: Record<string, any>,
  language_code?: string
) {
  const body: any = {};
  if (scope) body.scope = scope;
  if (language_code) body.language_code = language_code;
  return tgFetch(env, "deleteMyCommands", body);
}

export async function getMyCommands(
  env: Env,
  scope?: Record<string, any>,
  language_code?: string
) {
  const body: any = {};
  if (scope) body.scope = scope;
  if (language_code) body.language_code = language_code;
  return tgFetch<{ ok: boolean; result: Array<{ command: string; description: string }> }>(env, "getMyCommands", body);
}