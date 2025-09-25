// Конфіг через Env — ЖОДНИХ глобальних змінних на рівні модуля
export interface Env {
  BOT_TOKEN: string;              // обовʼязково
  API_BASE_URL?: string;          // опц., дефолт — офіц. телеграм
  OWNER_ID?: string;              // опц.
  STATE?: KVNamespace;            // якщо є KV
}

const DEFAULT_API_BASE_URL = "https://api.telegram.org";

export function loadConfig(env: Env) {
  const BOT_TOKEN = env.BOT_TOKEN;
  if (!BOT_TOKEN) {
    // явна й зрозуміла помилка, якщо змінну не передали
    throw new ReferenceError("BOT_TOKEN env var is required");
  }
  const API_BASE_URL = env.API_BASE_URL || DEFAULT_API_BASE_URL;
  const OWNER_ID = env.OWNER_ID;
  return { BOT_TOKEN, API_BASE_URL, OWNER_ID };
}

export type { Env as WorkerEnv };