// src/config.ts

// Загальний тип середовища для Worker
export type Env = {
  BOT_TOKEN: string;              // обов'язково
  API_BASE_URL?: string;          // опційно, дефолт https://api.telegram.org
  WEBHOOK_SECRET?: string;        // якщо використовуєш
  OWNER_ID?: string;              // якщо потрібно
  STATE?: KVNamespace;            // якщо використовуєш KV
};

let _env: Env | undefined;

/** Викликати на кожен запит перед використанням CFG */
export function setEnv(env: Env) {
  _env = env;
}

export function getEnv(): Env {
  if (!_env) throw new ReferenceError("Env is not initialized. Call setEnv(env) first.");
  return _env;
}

export const CFG = {
  apiBase(): string {
    const { API_BASE_URL } = getEnv();
    return API_BASE_URL || "https://api.telegram.org";
  },
  botToken(): string {
    const { BOT_TOKEN } = getEnv();
    if (!BOT_TOKEN) throw new ReferenceError("BOT_TOKEN is not defined");
    return BOT_TOKEN;
  },
};

// Мінімальні типи для запитів до Telegram API (потрібно для імпорту { TG } у коді)
export type TG = {
  chat_id: number | string;
  text?: string;
  reply_markup?: unknown;
  message_id?: number;
};