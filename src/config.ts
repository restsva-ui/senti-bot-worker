// src/config.ts
export type Env = {
  // існуючі
  BOT_TOKEN: string
  API_BASE_URL: string
  OWNER_ID?: string
  LIKES_KV?: KVNamespace

  // === для ШІ (MVP) ===
  AI_PROVIDER?: "groq" | "openai"
  AI_MODEL?: string
  AI_TIMEOUT_MS?: number
  MEMORY_MAX_TURNS?: number

  // secrets
  GROQ_API_KEY?: string
  OPENAI_API_KEY?: string
};

// Локальний кеш env, який виставляємо у entrypoint (index.ts)
let _env: Env | null = null;

export function setEnv(e: Env) {
  _env = e;
}
export function getEnv(): Env {
  if (!_env) throw new Error("Env not initialized");
  return _env!;
}

// --------- Утиліти для ШІ з дефолтами ---------
export function getAiProvider(): "groq" | "openai" {
  const env = getEnv();
  return env.AI_PROVIDER || "groq";
}
export function getAiModel(): string {
  const env = getEnv();
  return env.AI_MODEL || "llama-3.1-8b-instant";
}
export function getAiTimeout(): number {
  const env = getEnv();
  return Number(env.AI_TIMEOUT_MS || 20000);
}
export function getMemoryMaxTurns(): number {
  const env = getEnv();
  return Math.max(0, Number(env.MEMORY_MAX_TURNS ?? 4));
}

// --------- БЕК-СУМІСНІСТЬ З ІМПОРТОМ { CFG } ---------
// Деякі модулі імпортують { CFG }.
// Даємо шім з очікуваними полями: .env та .kv
export const CFG = {
  get env() {
    return getEnv();
  },
  get kv(): KVNamespace {
    const e = getEnv();
    if (!e.LIKES_KV) {
      // узгоджено з існуючими повідомленнями у боті
      throw new Error("KV не прив'язаний");
    }
    return e.LIKES_KV;
  },
} as const;