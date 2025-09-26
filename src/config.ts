// Централізовані типи та доступ до ENV/KV

export type Env = {
  BOT_TOKEN: string;         // secret у Cloudflare
  API_BASE_URL?: string;     // vars → "https://api.telegram.org"
  OWNER_ID?: string;         // vars → "784869835"
  LIKES_KV: KVNamespace;     // binding у wrangler.toml
};

export const CFG = {
  apiBase: (env: Env) => (env.API_BASE_URL || "https://api.telegram.org").replace(/\/+$/, ""),
  botToken: (env: Env) => env.BOT_TOKEN,
  ownerId:  (env: Env) => Number(env.OWNER_ID || 0),
  kv:       (env: Env) => env.LIKES_KV,
};

// Ключі KV
export const KV_KEYS = {
  COUNTS: "likes:counts",                 // {"like":number,"dislike":number}
  USER:   (id: number) => `likes:user:${id}`, // "like" | "dislike"
  ERRORS: "errors:rolling",               // JSON-масив останніх помилок
} as const;

// Допоміжний логер у KV (кільце на N записів)
export async function pushError(env: Env, tag: string, payload: unknown, limit = 50) {
  try {
    const kv = CFG.kv(env);
    const raw = (await kv.get(KV_KEYS.ERRORS)) || "[]";
    const arr = JSON.parse(raw) as any[];
    const item = {
      t: new Date().toISOString(),
      tag,
      payload,
    };
    arr.push(item);
    while (arr.length > limit) arr.shift();
    await kv.put(KV_KEYS.ERRORS, JSON.stringify(arr));
  } catch {
    // у крайніх випадках ковтаємо помилку логера
  }
}