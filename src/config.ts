// Уніфікована конфігурація/типи/ключі KV

export type Env = {
  BOT_TOKEN: string;          // secret у Cloudflare
  API_BASE_URL?: string;      // vars → "https://api.telegram.org"
  OWNER_ID?: string;          // vars → "784869835"
  LIKES_KV: KVNamespace;      // binding у wrangler.toml
};

export const CFG = {
  apiBase: (env: Env) => (env.API_BASE_URL || "https://api.telegram.org").replace(/\/+$/, ""),
  botToken: (env: Env) => env.BOT_TOKEN,
  ownerId:  (env: Env) => Number(env.OWNER_ID || 0),
  kv:       (env: Env) => env.LIKES_KV,
};

export const KV_KEYS = {
  COUNTS: "likes:counts",
  USER:   (id: number) => `likes:user:${id}`,
  ERRORS: "errors:rolling",
} as const;

export async function pushError(env: Env, tag: string, payload: unknown, limit = 50) {
  try {
    const kv = CFG.kv(env);
    const raw = (await kv.get(KV_KEYS.ERRORS)) || "[]";
    const arr = JSON.parse(raw) as any[];
    arr.push({ t: new Date().toISOString(), tag, payload });
    while (arr.length > limit) arr.shift();
    await kv.put(KV_KEYS.ERRORS, JSON.stringify(arr));
  } catch {
    // ковтаємо помилку логера
  }
}