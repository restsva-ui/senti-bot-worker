// src/services/ask.ts
// Smart /ask router: OpenRouter → Gemini → Cloudflare Workers AI (fallback) з пам’яттю

import type { Ai } from "@cloudflare/ai";
import type { Msg } from "./history";

export interface AskEnv {
  AI: Ai;
  OPENROUTER_API_KEY?: string;
  OR_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
}

export type AskResult = {
  text: string;
  provider: "openrouter" | "gemini" | "cloudflare-ai";
  model: string;
};

function getEnvKey(env: AskEnv, ...names: (keyof AskEnv)[]): string | undefined {
  for (const n of names) {
    const v = (env as any)?.[n];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/* -------------------- OpenRouter -------------------- */
async function askOpenRouter(
  env: AskEnv,
  prompt: string,
  history: Msg[],
  signal: AbortSignal
): Promise<AskResult> {
  const key = getEnvKey(env, "OPENROUTER_API_KEY", "OR_API_KEY");
  if (!key) throw new Error("no-openrouter-key");

  const candidates = [
    "anthropic/claude-3.7-sonnet",
    "meta-llama/llama-3.1-405b-instruct",
    "deepseek/deepseek-chat",
  ];

  const messages = [...history, { role: "user", content: prompt }].map(m => ({
    role: m.role,
    content: m.content,
  }));

  let lastErr: any;
  for (const model of candidates) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${key}`,
        },
        body: JSON.stringify({ model, messages, max_tokens: 512 }),
      });

      if (r.status >= 500 || r.status === 429) { lastErr = new Error(`openrouter:${model}:${r.status}`); continue; }
      if (!r.ok) { lastErr = new Error(`openrouter:${model}:${r.status}`); continue; }

      const data: any = await r.json();
      const text = data?.choices?.[0]?.message?.content?.toString?.() ?? "";
      if (!text) throw new Error("openrouter-empty");
      return { text, provider: "openrouter", model };
    } catch (e) { lastErr = e; continue; }
  }
  throw lastErr || new Error("openrouter-failed");
}

/* -------------------- Gemini -------------------- */
function toGeminiContents(history: Msg[], prompt: string) {
  return [...history, { role: "user", content: prompt }].map(m => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));
}

async function askGemini(
  env: AskEnv,
  prompt: string,
  history: Msg[],
  signal: AbortSignal
): Promise<AskResult> {
  const key = getEnvKey(env, "GEMINI_API_KEY", "GOOGLE_API_KEY");
  if (!key) throw new Error("no-gemini-key");

  const models = [
    "models/gemini-2.0-flash",
    "models/gemini-2.0-flash-lite",
    "models/gemini-1.5-flash",
  ];

  let lastErr: any;
  for (const model of models) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: toGeminiContents(history, prompt),
            generationConfig: { maxOutputTokens: 512, temperature: 0.7 },
          }),
        }
      );

      if (r.status >= 500 || r.status === 429) { lastErr = new Error(`gemini:${model}:${r.status}`); continue; }
      if (!r.ok) { lastErr = new Error(`gemini:${model}:${r.status}`); continue; }

      const data: any = await r.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      if (!text) throw new Error("gemini-empty");
      return { text, provider: "gemini", model };
    } catch (e) { lastErr = e; continue; }
  }
  throw lastErr || new Error("gemini-failed");
}

/* -------------------- Cloudflare Workers AI -------------------- */
async function askCloudflare(
  env: AskEnv,
  prompt: string,
  history: Msg[],
  signal: AbortSignal
): Promise<AskResult> {
  const models = [
    "@cf/meta/llama-3.1-70b-instruct",
    "@cf/meta/llama-3.1-8b-instruct",
  ];

  const messages = [...history, { role: "user", content: prompt }];

  let lastErr: any;
  for (const model of models) {
    try {
      const r: any = await (env.AI as any).run(
        model,
        { messages, max_tokens: 512 },
        { signal } as any
      );
      const text = (r?.response ?? r?.result?.response ?? "").toString();
      if (!text) throw new Error("cf-empty");
      return { text, provider: "cloudflare-ai", model };
    } catch (e) { lastErr = e; continue; }
  }
  throw lastErr || new Error("cloudflare-failed");
}

/* -------------------- Публічна функція -------------------- */
export async function smartAsk(env: AskEnv, prompt: string, history: Msg[] = []): Promise<AskResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("ask-timeout"), 25_000);

  try {
    if (getEnvKey(env, "OPENROUTER_API_KEY", "OR_API_KEY")) {
      try { return await askOpenRouter(env, prompt, history, controller.signal); } catch {}
    }
    if (getEnvKey(env, "GEMINI_API_KEY", "GOOGLE_API_KEY")) {
      try { return await askGemini(env, prompt, history, controller.signal); } catch {}
    }
    return await askCloudflare(env, prompt, history, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}