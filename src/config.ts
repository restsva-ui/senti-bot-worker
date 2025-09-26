// src/config.ts

/**
 * Глобальна конфігурація, яку встановлюємо в src/index.ts
 * через setEnv(env). Потім у будь-якому місці коду використовуємо getEnv().
 */

export type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;      // за замовчуванням https://api.telegram.org
  OWNER_ID?: string;
  LIKES_KV?: KVNamespace;     // binding з wrangler.toml: LIKES_KV
};

let ENV_REF: Env | undefined;

/** Викликай один раз у entrypoint (src/index.ts) */
export function setEnv(env: Env) {
  ENV_REF = env;
}

/** Отримати конфіг з дефолтами, не ламаючи існуючу логіку */
export function getEnv(): Env & Required<Pick<Env, "BOT_TOKEN">> {
  if (!ENV_REF) {
    throw new Error("Env is not initialized. Call setEnv(env) in src/index.ts first.");
  }
  // дефолтна база для Telegram
  return {
    API_BASE_URL: "https://api.telegram.org",
    ...ENV_REF,
  } as Env & Required<Pick<Env, "BOT_TOKEN">>;
}