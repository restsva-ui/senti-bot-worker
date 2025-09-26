// src/config.ts

export type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
  OWNER_ID?: string;
  /**
   * ВАЖЛИВО: назва збігається з binding у wrangler.toml
   * [[kv_namespaces]] binding = "LIKES_KV"
   */
  LIKES_KV?: KVNamespace;
};

// Тримай актуальне оточення у модулі, щоб діставати з будь-якого файлу
let CURRENT_ENV: Env | undefined;

export function setEnv(env: Env) {
  CURRENT_ENV = env;
}

export function getEnv(): Env {
  if (!CURRENT_ENV) {
    throw new Error("Environment is not set. Call setEnv(env) first.");
  }
  return CURRENT_ENV;
}