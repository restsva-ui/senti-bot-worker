// src/config.ts
export type Env = {
  // уже існуючі в тебе прив’язки:
  BOT_TOKEN: string        // secret
  API_BASE_URL: string     // var, "https://api.telegram.org"
  OWNER_ID?: string        // var
  LIKES_KV?: KVNamespace   // binding

  // === Нове для ШІ ===
  // провайдер: "groq" (безкоштовно) або "openai" (платно)
  AI_PROVIDER?: "groq" | "openai"
  // модель за замовчуванням (під Groq ставимо швидку Llama)
  AI_MODEL?: string
  // таймаут на відповідь моделі, мс
  AI_TIMEOUT_MS?: number
  // макс. кількість пар реплік у пам'яті
  MEMORY_MAX_TURNS?: number

  // secrets (додаються через wrangler secret)
  GROQ_API_KEY?: string
  OPENAI_API_KEY?: string
};

// У Cloudflare Workers `env` передається у fetch(). Робимо простий геттери.
let _env: Env | null = null;

export function setEnv(e: Env) {
  _env = e;
}

export function getEnv(): Env {
  if (!_env) throw new Error("Env not initialized");
  return _env!;
}

// Допоміжні дефолти (щоб не падало без vars)
export function getAiProvider(): "groq" | "openai" {
  const env = getEnv();
  return (env.AI_PROVIDER || "groq"); // за замовчуванням безкоштовний Groq
}
export function getAiModel(): string {
  const env = getEnv();
  // дефолт під Groq — швидка 8B
  return env.AI_MODEL || "llama-3.1-8b-instant";
}
export function getAiTimeout(): number {
  const env = getEnv();
  return Number(env.AI_TIMEOUT_MS || 20000);
}
export function getMemoryMaxTurns(): number {
  const env = getEnv();
  return Math.max(0, Number(env.MEMORY_MAX_TURNS ?? 4)); // 4 пари реплік для MVP
}