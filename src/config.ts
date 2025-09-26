// Централізована конфігурація (проста й надійна)
export type Env = {
  API_BASE_URL?: string;
  BOT_TOKEN: string;
  OWNER_ID?: string;

  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_MODEL_VISION?: string;
  CF_AI_GATEWAY_BASE?: string;

  KV: KVNamespace;
};

let _env: Env | undefined;

export function setEnv(env: Env) {
  _env = env;
}

export function CFG() {
  if (!_env) throw new Error("Env is not set");
  const apiBase = (_env.API_BASE_URL || "https://api.telegram.org").replace(/\/+$/g, "");
  return {
    apiBase, // string
    botToken: _env.BOT_TOKEN || "",
    ownerId: _env.OWNER_ID || "",

    openrouterKey: _env.OPENROUTER_API_KEY || "",
    openrouterModel: _env.OPENROUTER_MODEL || "meta-llama/llama-3.1-70b-instruct",
    openrouterModelVision: _env.OPENROUTER_MODEL_VISION || "openai/gpt-4o-mini",
    cfGateway: _env.CF_AI_GATEWAY_BASE || "",
  };
}

export function KVns(): KVNamespace {
  if (!_env) throw new Error("Env is not set");
  return _env.KV;
}