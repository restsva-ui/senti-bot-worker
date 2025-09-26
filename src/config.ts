// Глобальні типи середовища та зручний доступ до них
export interface Env {
  LIKES_KV: KVNamespace;
  BOT_TOKEN: string;
  API_BASE_URL: string; // "https://api.telegram.org"
  OWNER_ID: string;     // "784869835"
}

export const CFG = {
  apiBase: (env: Env) => env.API_BASE_URL || "https://api.telegram.org",
  botToken: (env: Env) => env.BOT_TOKEN,
  kv: (env: Env) => env.LIKES_KV,
  ownerId: (env: Env) => Number(env.OWNER_ID || 0),
};