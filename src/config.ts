// src/config.ts

/**
 * Централізоване читання ENV у Cloudflare Worker.
 * router.ts викликає setEnv(env) на кожен запит.
 */

export type Env = {
  // Telegram
  API_BASE_URL: string;   // напр. "https://api.telegram.org"
  BOT_TOKEN: string;

  // Контроль доступу
  OWNER_ID?: string;
  PREMIUM_CODE?: string;

  // LLM провайдери (опційні)
  AI_PROVIDER?: "auto" | "groq" | "deepseek" | "gemini" | "openrouter";
  GROQ_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_MODEL_VISION?: string;
  CF_AI_GATEWAY_BASE?: string;

  // Інші сервіси (за бажанням)
  REDIS_URL?: string;
  REDIS_TOKEN?: string;
  CLOUDFLARE_API_TOKEN?: string; // виправлена назва
};

// Поточний ENV (в модулі)
let CURRENT_ENV: Env | null = null;

export function setEnv(env: Env) {
  CURRENT_ENV = env;
  (globalThis as any).__ENV = env; // для доступу з інших модулів
}

export function env(): Env {
  if (!CURRENT_ENV) {
    const g = (globalThis as any).__ENV as Env | undefined;
    if (g) CURRENT_ENV = g;
    else throw new Error("ENV is not initialized. Call setEnv(env) first.");
  }
  return CURRENT_ENV!;
}

/** СУМІСНІСТЬ: старі модулі можуть імпортувати getEnv() */
export function getEnv(): Env {
  return env();
}

/** Утиліти */
export type TG = { token: string; apiBase: string };

export const CFG = {
  get tg(): TG {
    const e = env();
    const token = e.BOT_TOKEN;
    if (!token) throw new Error("BOT_TOKEN is missing");
    const apiBase = e.API_BASE_URL || "https://api.telegram.org";
    return { token, apiBase };
  },

  get ownerId(): string | undefined {
    const id = env().OWNER_ID;
    return id ? String(id) : undefined;
  },

  get premiumCode(): string | undefined {
    return env().PREMIUM_CODE;
  },

  get llm() {
    const e = env();
    return {
      provider: (e.AI_PROVIDER || "auto") as NonNullable<Env["AI_PROVIDER"]>,
      groqKey: e.GROQ_API_KEY,
      deepseekKey: e.DEEPSEEK_API_KEY,
      geminiKey: e.GEMINI_API_KEY,
      openrouterKey: e.OPENROUTER_API_KEY,
      openrouterModel: e.OPENROUTER_MODEL,
      openrouterVisionModel: e.OPENROUTER_MODEL_VISION,
      gatewayBase: e.CF_AI_GATEWAY_BASE,
    };
  },

  get raw(): Env {
    return env();
  },
};