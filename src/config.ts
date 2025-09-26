// src/config.ts

// ---- Типи оточення (Workers) ----
export type Env = {
  API_BASE_URL?: string;
  BOT_TOKEN?: string;

  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_MODEL_VISION?: string;

  CF_AI_GATEWAY_BASE?: string;
  OWNER_ID?: string;
  PREMIUM_CODE?: string;
  WEBHOOK_SECRET?: string;

  // KV binding
  KV: KVNamespace;
};

let _env: Env | null = null;

// Ініціалізація з роутера
export function setEnv(env: Env) {
  _env = env;
}

// СУМІСНІСТЬ: старі місця імпортують getEnv() і беруть звідти env.KV тощо.
export function getEnv(): Env {
  if (!_env) throw new Error("Env not set");
  return _env;
}

// ---- Уніфікований доступ до налаштувань ----
// Поля CFG — ФУНКЦІЇ (щоб виклики CFG.xxx() працювали). Для зручності є getCfg('key').
export const CFG = {
  apiBase: () => (_env?.API_BASE_URL || "https://api.telegram.org"),
  botToken: () => (_env?.BOT_TOKEN || ""),

  openrouterKey: () => (_env?.OPENROUTER_API_KEY || ""),
  openrouterModel: () =>
    (_env?.OPENROUTER_MODEL || "meta-llama/llama-3.1-70b-instruct"),
  openrouterVisionModel: () =>
    (_env?.OPENROUTER_MODEL_VISION || "openai/gpt-4o-mini"),

  cfAiGatewayBase: () => (_env?.CF_AI_GATEWAY_BASE || ""),
  ownerId: () => (_env?.OWNER_ID || ""),
  premiumCode: () => (_env?.PREMIUM_CODE || ""),
  webhookSecret: () => (_env?.WEBHOOK_SECRET || ""),
} as const;

type CfgKey = keyof typeof CFG;

/** Отримати значення CFG як рядок */
export function getCfg<K extends CfgKey>(key: K): string {
  try {
    const fn = CFG[key] as unknown as () => string;
    return fn ? fn() : "";
  } catch {
    return "";
  }
}

// ---- Хелпери для KV (нові місця можуть користуватись ними) ----
function kv(): KVNamespace {
  if (!_env) throw new Error("Env not set");
  return _env.KV;
}

export async function kvGet<T = unknown>(key: string): Promise<T | null> {
  const raw = await kv().get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}

export async function kvPut(key: string, value: unknown, ttlSeconds?: number) {
  const v = typeof value === "string" ? value : JSON.stringify(value);
  if (ttlSeconds && ttlSeconds > 0) {
    await kv().put(key, v, { expirationTtl: ttlSeconds });
  } else {
    await kv().put(key, v);
  }
}

export async function kvDel(key: string) {
  await kv().delete(key);
}