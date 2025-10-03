// src/adapters/telegram.ts
// Backward-compatible адаптер. Делегує виклики у utils/telegram і використовує правильний BOT_TOKEN.

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

// Залишаємо експорти з такими ж іменами, якщо старий код їх імпортував.
export { tgSendMessage, answerCallbackQuery, editMessageText, getFile, tgGetFileUrl, setMyCommands };

// Мінімальна сумісність із старою функцією tg(env, method, body)
export async function tg(env: Env, method: string, body: Record<string, any>) {
  // перенаправляємо у fetch через generic endpoint
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