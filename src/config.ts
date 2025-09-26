// Єдине місце правди для оточення і KV

export type Env = {
  LIKES_KV: KVNamespace;
  API_BASE_URL?: string;
  BOT_TOKEN: string;
  OWNER_ID?: string; // або number як рядок
};

let _env: Env | null = null;

export function setEnv(e: Env) {
  _env = e;
}

export function getEnv(): Env {
  if (!_env) throw new Error("Env not set – call setEnv(env) in entrypoint");
  return _env;
}

// Зручний фасад. НІЯКИХ прямих звернень до process/env у коді.
// Все тільки через CFG.
export const CFG = {
  get kv(): KVNamespace {
    return getEnv().LIKES_KV;
  },
  get apiBase(): string {
    return getEnv().API_BASE_URL || "https://api.telegram.org";
  },
  get botToken(): string {
    return getEnv().BOT_TOKEN;
  },
  get ownerId(): number {
    const raw = getEnv().OWNER_ID || "0";
    return Number(raw);
  },
};