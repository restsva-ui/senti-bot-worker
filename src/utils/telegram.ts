// src/utils/telegram.ts
// Уніфіковані та стабільні хелпери Telegram API для Cloudflare Workers (ESM)

export type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;            // опційно: кастомний endpoint (наприклад, локальний проксі)
};

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const TG_MAX_LEN = 4096;

/** Повертає повну базову URL для Telegram API. */
function apiBase(env: Env): string {
  const base = (env.API_BASE_URL || "https://api.telegram.org").replace(/\/+$/, "");
  return `${base}/bot${env.BOT_TOKEN}`;
}

/** Невеликий обгортковий fetch з логуванням помилок. */
async function tgFetch<T=any>(env: Env, method: string, body: Record<string, any>): Promise<T> {
  const url = `${apiBase(env)}/${method}`;
  const res = await fetch(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
  if (!res.ok) {
    let text = "";
    try { text = await res.text(); } catch {}
    console.error("Telegram API error:", { method, status: res.status, text });
  }
  return res.json() as Promise<T>;
}

/* ------------------------ Public helpers ------------------------ */

/** Надіслати повідомлення з авто-розбиттям >4096 символів. */
export async function tgSendMessage(
  env: Env,
  chat_id: number | string,
  text: string,
  extra: Record<string, any> = {}
) {
  // Якщо текст довгий — бʼємо на чанки
  if ((text ?? "").length > TG_MAX_LEN) {
    const chunks: string[] = [];
    let i = 0;
    while (i < text.length) {
      chunks.push(text.slice(i, i + TG_MAX_LEN));
      i += TG_MAX_LEN;
    }
    // надсилаємо послідовно
    for (const [idx, chunk] of chunks.entries()) {
      const prefix = idx === 0 ? "" : `\n(продовження ${idx + 1}/${chunks.length})\n`;
      // eslint-disable-next-line no-await-in-loop
      await tgFetch(env, "sendMessage", { chat_id, text: prefix + chunk, parse_mode: "HTML", ...extra });
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

/** Побудувати direct URL до файлу (file_path) на базі getFile. */
export async function tgGetFileUrl(file_id: string, env: Env) : Promise<string> {
  const info = await getFile(env, file_id);
  const file_path = info?.result?.file_path || "";
  if (!file_path) throw new Error("tgGetFileUrl: empty file_path");
  const base = (env.API_BASE_URL || "https://api.telegram.org").replace(/\/+$/, "");
  return `${base}/file/bot${env.BOT_TOKEN}/${file_path}`;
}

export async function setMyCommands(env: Env, commands: Array<{ command: string; description: string }>, scope?: any) {
  const body: any = { commands };
  if (scope) body.scope = scope;
  return tgFetch(env, "setMyCommands", body);
}