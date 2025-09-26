// Централізоване зберігання ENV та доступ до KV

export type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;         // опційно (за замовчуванням https://api.telegram.org)
  LIKES_KV: KVNamespace;         // <- назва біндингу KV у wrangler.toml
};

let ENV: Env | undefined;

export function setEnv(env: Env) {
  ENV = env;
  CFG.kv = env.LIKES_KV;         // важливо: сюди кладемо саме KVNamespace
}

export function getEnv(): Env {
  if (!ENV) throw new Error("ENV is not initialized");
  return ENV;
}

export const CFG = {
  kv: undefined as unknown as KVNamespace, // після setEnv стане справжнім KV
};