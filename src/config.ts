// Централізована робота з ENV + сумісність зі старими викликами CFG.apiBase()/CFG.botToken()

export type Env = {
  API_BASE_URL: string;           // напр.: https://api.telegram.org
  BOT_TOKEN: string;

  // опційні інтеграції
  CF_AI_GATEWAY_BASE?: string;

  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_MODEL_VISION?: string;

  OWNER_ID?: string;
  PREMIUM_CODE?: string;

  // опційно для лічильників/стану
  STATE?: KVNamespace;
};

let _env: Env | null = null;

export function setEnv(env: Env) { _env = env; }

function need(name: keyof Env): string {
  const v = (_env as any)?.[name];
  if (!v || typeof v !== "string") throw new Error(`Missing required env: ${String(name)}`);
  return v;
}
function opt(name: keyof Env): string | undefined {
  const v = (_env as any)?.[name];
  return typeof v === "string" && v.length ? v : undefined;
}

export const CFG: any = {
  // основні гетери
  get API_BASE_URL(): string { return need("API_BASE_URL"); },
  get BOT_TOKEN(): string    { return need("BOT_TOKEN"); },

  get CF_AI_GATEWAY_BASE(): string | undefined { return opt("CF_AI_GATEWAY_BASE"); },

  get OPENROUTER_API_KEY(): string | undefined { return opt("OPENROUTER_API_KEY"); },
  get OPENROUTER_MODEL(): string | undefined { return opt("OPENROUTER_MODEL"); },
  get OPENROUTER_MODEL_VISION(): string | undefined { return opt("OPENROUTER_MODEL_VISION"); },

  get OWNER_ID(): string | undefined { return opt("OWNER_ID"); },
  get PREMIUM_CODE(): string | undefined { return opt("PREMIUM_CODE"); },

  get STATE(): KVNamespace | undefined { return (_env as any)?.STATE as KVNamespace | undefined },
};

// 🧩 СУМІСНІСТЬ ЗІ СТАРИМ КОДОМ
// Старий код міг робити виклики як функції:
CFG.apiBase   = () => CFG.API_BASE_URL;
CFG.botToken  = () => CFG.BOT_TOKEN;
// (додаткові синоніми, якщо десь використовувались)
CFG.baseUrl   = () => CFG.API_BASE_URL;
CFG.token     = () => CFG.BOT_TOKEN;

export function getEnv(): Env | null { return _env; }