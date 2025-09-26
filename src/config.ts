// src/config.ts

export interface Env {
  // CF bindings
  KV?: KVNamespace;
  // vars / secrets
  API_BASE_URL: string;
  BOT_TOKEN: string;
  OR_KEY?: string;           // OpenRouter key (optional)
  OWNER_ID?: string;         // numeric as string
  CF_AI_GATEWAY?: string;    // optional
}

let _env: Env | null = null;

/** Викликаємо один раз на старті запиту (у fetch) */
export function setEnv(env: Record<string, unknown>) {
  // м'яко читаємо варіанти назв, щоб не падати
  const e = env as any;
  _env = {
    KV: e.KV,
    API_BASE_URL: e.API_BASE_URL ?? "https://api.telegram.org",
    BOT_TOKEN: e.BOT_TOKEN,
    OR_KEY: e.OR_KEY ?? e.OPENROUTER_KEY,
    OWNER_ID: e.OWNER_ID,
    CF_AI_GATEWAY: e.CF_AI_GATEWAY,
  };
}

/** Отримати активне оточення всередині хендлерів */
export function getEnv(): Env {
  if (!_env) throw new Error("Env is not initialized. Call setEnv() early.");
  return _env!;
}

/** Зручні геттери (опційно) */
export const CFG = {
  apiBase(): string { return getEnv().API_BASE_URL; },
  botToken(): string { return getEnv().BOT_TOKEN; },
  openrouterKey(): string | undefined { return getEnv().OR_KEY; },
  kv(): KVNamespace | undefined { return getEnv().KV; },
};