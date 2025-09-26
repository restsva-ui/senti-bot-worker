// src/config.ts

// ---- Типи оточення (Workers) ----
export type Env = {
  // Secrets / Vars
  API_BASE_URL: string | undefined;
  BOT_TOKEN: string | undefined;

  OPENROUTER_API_KEY: string | undefined;
  OPENROUTER_MODEL: string | undefined;
  OPENROUTER_MODEL_VISION: string | undefined;

  CF_AI_GATEWAY_BASE: string | undefined;
  OWNER_ID: string | undefined;
  PREMIUM_CODE: string | undefined;
  WEBHOOK_SECRET?: string | undefined;

  // KV
  KV: KVNamespace;
};

let _env: Env | null = null;
export function setEnv(env: Env) {
  _env = env;
}

// ---- Уніфікований доступ до CFG ----
// УВАГА: поля CFG — ФУНКЦІЇ, щоб старі виклики CFG.xxx() працювали.
// Для місць, де очікується рядок, користуйся getCfg('key') або cfg('key')

export const CFG = {
  apiBase: () => _env?.API_BASE_URL || "https://api.telegram.org",
  botToken: () => _env?.BOT_TOKEN || "",

  openrouterKey: () => _env?.OPENROUTER_API_KEY || "",
  openrouterModel: () =>
    _env?.OPENROUTER_MODEL || "meta-llama/llama-3.1-70b-instruct",
  openrouterVisionModel: () =>
    _env?.OPENROUTER_MODEL_VISION || "openai/gpt-4o-mini",

  cfAiGatewayBase: () => _env?.CF_AI_GATEWAY_BASE || "",
  ownerId: () => _env?.OWNER_ID || "",
  premiumCode: () => _env?.PREMIUM_CODE || "",
  webhookSecret: () => _env?.WEBHOOK_SECRET || "",
} as const;

type CfgKey = keyof typeof CFG;

/** Повертає значення поля CFG як рядок (незалежно від того, як його викликають в коді) */
export function getCfg<K extends CfgKey>(key: K): string {
  // поля — функції
  try {
    const fn = CFG[key] as unknown as () => string;
    return fn ? fn() : "";
  } catch {
    return "";
  }
}

// ---- Простенькі хелпери для KV ----
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
  const v =
    typeof value === "string" ? value : JSON.stringify(value, null, 0);
  if (ttlSeconds && ttlSeconds > 0) {
    await kv().put(key, v, { expirationTtl: ttlSeconds });
  } else {
    await kv().put(key, v);
  }
}

export async function kvDel(key: string) {
  await kv().delete(key);
}