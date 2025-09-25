// Telegram helper for Cloudflare Workers + TypeScript
// Працює з існуючим router.ts (sendMessage, answerCallbackQuery тощо)

import { API_BASE_URL, BOT_TOKEN } from "../config";

// --- Типи Telegram -----------------------------------------------------------
type TGInlineKeyboardButton = {
  text: string;
  url?: string;
  callback_data?: string;
};

type TGReplyMarkup =
  | {
      inline_keyboard: TGInlineKeyboardButton[][];
    }
  | undefined;

type TGSendMessageReq = {
  chat_id: number;
  text: string;
  parse_mode?: "MarkdownV2" | "HTML" | "Markdown";
  disable_web_page_preview?: boolean;
  reply_markup?: TGReplyMarkup;
};

type TGAnswerCallbackReq = {
  callback_query_id: string;
  text?: string;
  show_alert?: boolean;
  cache_time?: number;
};

type TGSetWebhookReq = {
  url: string;
  max_connections?: number;
  allowed_updates?: string[];
  secret_token?: string;
  drop_pending_updates?: boolean;
};

type TGDeleteWebhookReq = {
  drop_pending_updates?: boolean;
};

type TGWebhookInfo = {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  ip_address?: string;
  last_error_date?: number;
  last_error_message?: string;
  last_synchronization_error_date?: number;
  max_connections?: number;
  allowed_updates?: string[];
};

type TGUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
};

type TGMessage = {
  message_id: number;
  date: number;
  chat: { id: number; type: "private" | "group" | "supergroup" | "channel" };
  text?: string;
  from?: TGUser;
};

type TGApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

// --- Базові константи --------------------------------------------------------
const API = `${API_BASE_URL}/bot${BOT_TOKEN}`;

// --- Базовий виклик API ------------------------------------------------------
async function apiCall<T>(method: string, payload?: Record<string, any>): Promise<T> {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json;charset=utf-8" },
    body: payload ? JSON.stringify(payload) : "{}",
  });

  const data = (await res.json()) as TGApiResponse<T>;
  if (!data.ok) {
    const msg = `Telegram API error on ${method}: ${data.error_code ?? ""} ${data.description ?? ""}`.trim();
    throw new Error(msg);
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return data.result!;
}

// --- Публічні функції --------------------------------------------------------
export async function sendMessage(
  chatId: number,
  text: string,
  opts?: {
    parse_mode?: "MarkdownV2" | "HTML" | "Markdown";
    disable_web_page_preview?: boolean;
    reply_markup?: TGReplyMarkup;
  }
): Promise<TGMessage> {
  const req: TGSendMessageReq = {
    chat_id: chatId,
    text,
    parse_mode: opts?.parse_mode,
    disable_web_page_preview: opts?.disable_web_page_preview,
    reply_markup: opts?.reply_markup,
  };
  return apiCall<TGMessage>("sendMessage", req);
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  params?: { text?: string; show_alert?: boolean; cache_time?: number }
): Promise<true> {
  const req: TGAnswerCallbackReq = {
    callback_query_id: callbackQueryId,
    text: params?.text,
    show_alert: params?.show_alert,
    cache_time: params?.cache_time,
  };
  return apiCall<true>("answerCallbackQuery", req);
}

// Адміністраторські/діагностичні утиліти (зручно викликати з ручних перевірок)
export async function setWebhook(params: TGSetWebhookReq): Promise<true> {
  return apiCall<true>("setWebhook", params);
}

export async function deleteWebhook(params?: TGDeleteWebhookReq): Promise<true> {
  return apiCall<true>("deleteWebhook", params ?? {});
}

export async function getWebhookInfo(): Promise<TGWebhookInfo> {
  return apiCall<TGWebhookInfo>("getWebhookInfo", {});
}

export async function getMe(): Promise<TGUser> {
  return apiCall<TGUser>("getMe", {});
}

// Корисна дрібничка для "typing…" (за бажанням)
/*
export async function sendChatAction(chatId: number, action: "typing" | "upload_photo" | "record_voice"): Promise<true> {
  return apiCall<true>("sendChatAction", { chat_id: chatId, action });
}
*/

// Експортуємо корисні типи, якщо треба в інших місцях
export type { TGReplyMarkup, TGInlineKeyboardButton, TGMessage, TGUser, TGWebhookInfo };