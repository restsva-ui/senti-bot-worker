import { CFG } from "../config";

function apiBase(): string {
  return CFG.apiBase.replace(/\/+$/, "");
}

function bot(): string {
  return `bot${CFG.botToken}`;
}

async function tgPost(method: string, body: unknown) {
  const url = `${apiBase()}/${bot()}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Telegram API ${method} failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function sendMessage(
  chat_id: number,
  text: string,
  extra?: Record<string, unknown>
) {
  return tgPost("sendMessage", { chat_id, text, parse_mode: "HTML", ...extra });
}

export async function editMessageText(
  chat_id: number,
  message_id: number,
  text: string,
  extra?: Record<string, unknown>
) {
  return tgPost("editMessageText", {
    chat_id,
    message_id,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

export async function answerCallbackQuery(
  text?: string,
  show_alert = false
) {
  return tgPost("answerCallbackQuery", {
    // telegram сам підставляє callback_query_id через webhook, але
    // у Workers ми передаємо його з router (див. handleUpdate)
    callback_query_id: (globalThis as any).__cb_id,
    text,
    show_alert,
  });
}

export async function setMyCommands() {
  // не обов'язково, але корисно
  const commands = [
    { command: "start", description: "Запуск і привітання" },
    { command: "ping", description: "Перевірка живості бота" },
    { command: "menu", description: "Головне меню" },
    { command: "likepanel", description: "Панель лайків" },
    { command: "help", description: "Довідка" },
    { command: "kvtest", description: "Діагностика KV" },
    { command: "resetlikes", description: "Скинути лічильники лайків" },
  ];
  return tgPost("setMyCommands", { commands });
}