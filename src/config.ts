// src/config.ts

export type RuntimeEnv = {
  LIKES_KV: KVNamespace;
  API_BASE_URL?: string;
  OWNER_ID?: string | number;
  BOT_TOKEN: string;
};

export type AppEnv = {
  /** alias під твій namespace з чек-листа */
  kv: KVNamespace;
  /** https://api.telegram.org за замовчуванням */
  API_BASE_URL: string;
  /** numeric owner id з чек-листа */
  OWNER_ID: number;
  /** секретний токен бота */
  BOT_TOKEN: string;
};

let _env: AppEnv | null = null;

/** Викликаємо з index.ts на кожен запрос */
export function setEnv(e: RuntimeEnv) {
  if (!e || !e.LIKES_KV) {
    throw new Error("LIKES_KV binding is missing");
  }
  if (!e.BOT_TOKEN) {
    throw new Error("BOT_TOKEN secret is missing");
  }
  _env = {
    kv: e.LIKES_KV,
    API_BASE_URL: e.API_BASE_URL || "https://api.telegram.org",
    OWNER_ID: Number(e.OWNER_ID ?? 784869835),
    BOT_TOKEN: e.BOT_TOKEN,
  };
}

/** Дістаємо сконфігуроване оточення в будь-якому місці */
export function getEnv(): AppEnv {
  if (!_env) throw new Error("Env not initialized. Call setEnv(...) first.");
  return _env;
}

/** Зручний проксі (сумісний із існуючим кодом типу CFG.kv.get/put) */
export const CFG = new Proxy({} as AppEnv, {
  get(_t, p: keyof AppEnv) {
    return (getEnv() as any)[p];
  },
}) as AppEnv;