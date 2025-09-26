// src/config.ts

/**
 * Єдине джерело правди для ENV у рантаймі Worker.
 * router.ts викликає setEnv(env) на кожен запит — далі вся решта коду читає через CFG / env().
 */

export type Env = {
  // Telegram
  API_BASE_URL: string;            // напр. "https://api.telegram.org"
  BOT_TOKEN: string;

  // Контроль доступу / адмін
  OWNER_ID?: string;
  PREMIUM_CODE?: string;

  // LLM провайдери (опційно, для /ask та ін.)
  AI_PROVIDER?: "auto" | "groq" | "deepseek" | "gemini" | "openrouter";
  GROQ_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_MODEL_VISION?: string;
  CF_AI_GATEWAY_BASE?: string;

  // Сторонні сервіси (за бажанням)
  REDIS_URL?: string;
  REDIS_TOKEN?: string;
  CLOUDFARE_API_TOKEN?: string; // якщо десь використовуватимеш
};

// Поточне ENV зберігаємо в модулі + кладемо в globalThis для зручного доступу.
let CURRENT_ENV: Env | null = null;

export function setEnv(env: Env) {
  CURRENT_ENV = env;
  // дозволяє читати ENV з будь-якого місця без пробросу параметром
  (globalThis as any).__ENV = env;
}

export function env(): Env {
  if (!CURRENT_ENV) {
    // fallback на globalThis (якщо хтось викликав раніше за setEnv)
    const g = (globalThis as any).__ENV as Env | undefined;
    if (g) {
      CURRENT_ENV = g;
    } else {
      throw new Error("ENV is not initialized. Call setEnv(env) first.");
    }
  }
  return CURRENT_ENV!;
}

/** Зручні типи/гетери для Telegram */
export type TG = { token: string; apiBase: string };

export const CFG = {
  /** Налаштування Telegram — кидатиме помилку, якщо немає BOT_TOKEN */
  get tg(): TG {
    const e = env();
    const token = e.BOT_TOKEN;
    if (!token) throw new Error("BOT_TOKEN is missing");
    const apiBase = e.API_BASE_URL || "https://api.telegram.org";
    return { token, apiBase };
  },

  /** ID власника для розширених прав/лімітів */
  get ownerId(): string | undefined {
    const id = env().OWNER_ID;
    return id ? String(id) : undefined;
  },

  /** Преміум-код (якщо захочеш увімкнути преміум) */
  get premiumCode(): string | undefined {
    return env().PREMIUM_CODE;
  },

  /** Налаштування LLM (для /ask тощо) */
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

  /** Сирове ENV (іноді корисно) */
  get raw(): Env {
    return env();
  },
};