// src/adapters/telegram.ts
// Backward-compatible адаптер: використовує саме BOT_TOKEN (а не TELEGRAM_TOKEN)

import {
  tgSendMessage,
  answerCallbackQuery,
  editMessageText,
  getFile,
  tgGetFileUrl,
  setMyCommands,
  type Env as TGEnv,
} from "../utils/telegram";

export type Env = TGEnv;

export { tgSendMessage, answerCallbackQuery, editMessageText, getFile, tgGetFileUrl, setMyCommands };

export async function tg(env: Env, method: string, body: Record<string, any>) {
  const base = (env.API_BASE_URL || "https://api.telegram.org").replace(/\/+$/, "");
  const url = `${base}/bot${env.BOT_TOKEN}/${method}`;
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });
  if (!res.ok) {
    let text = "";
    try { text = await res.text(); } catch {}
    console.error("TG API error:", { method, status: res.status, text });
  }
  return res.json();
}