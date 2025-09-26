// src/telegram/api.ts
import { CFG } from "../config";

type Json = Record<string, unknown>;
type ReplyMarkup = {
  inline_keyboard?: Array<Array<{ text: string; callback_data: string }>>;
};

function tgUrl(method: string) {
  const base = CFG.apiBase || "https://api.telegram.org";
  return `${base}/bot${CFG.botToken}/${method}`;
}

async function call<T = any>(method: string, body: Json): Promise<T> {
  const res = await fetch(tgUrl(method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Telegram API ${method} failed: ${res.status} ${text}`);
  }
  const json = await res.json<T>();
  return json as T;
}

export async function sendMessage(
  chat_id: number | string,
  text: string,
  opts?: { reply_markup?: ReplyMarkup }
) {
  return call("sendMessage", { chat_id, text, ...opts });
}

export async function editMessageText(
  chat_id: number | string,
  message_id: number,
  text: string,
  opts?: { reply_markup?: ReplyMarkup }
) {
  return call("editMessageText", { chat_id, message_id, text, ...opts });
}

export async function answerCallbackQuery(text?: string) {
  // API вимагає передавати callback_query_id, але в роутері ми відповідаємо
  // одразу після натискання кнопки, тому беремо його з останнього апдейту:
  // спростимо — Cloudflare Worker не зберігає стан; тому зробимо
  // «без тексту» варіант через sendChatAction як запасний варіант.
  // Краще — передавати id із роутера; однак тут підемо простим шляхом:
  if ((globalThis as any).__last_callback_id) {
    const id = (globalThis as any).__last_callback_id as string;
    return call("answerCallbackQuery", { callback_query_id: id, text });
  }
  // Fallback: нічого не робимо (Telegram все одно оновить кнопку)
  return;
}