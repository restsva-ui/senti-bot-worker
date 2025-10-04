// src/services/ask.ts
// Smart /ask router with fallbacks: OpenRouter → Gemini → Cloudflare Workers AI
// Тепер підтримує історію діалогу, systemPrompt, maxTokens, temperature.

import type { Ai } from "@cloudflare/ai";

/** Мінімум того, що потрібно для роутера */
export interface AskEnv {
  AI: Ai;

  OPENROUTER_API_KEY?: string;
  OR_API_KEY?: string;

  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
}

/** Опції для розумного виклику */
export interface AskOptions {
  chatId?: number | string;
  /** Історія діалогу (лише останні k ходів реально підуть у запит) */
  history?: ChatTurn[];
  /** Системна інструкція для моделей (де підтримується) */
  systemPrompt?: string;
  /** Ліміти генерації */
  maxTokens?: number;       // default 512
  temperature?: number;     // default 0.6
  /** Скільки ходів із history брати (парами user/assistant) */
  historyTurns?: number;    // default 6 (приблизно останні 6-12 повідомлень)
}

/** Узагальнений формат turn для історії */
export type ChatTurn = {
  role: "system" | "user" | "assistant";
  content: string;
  ts?: number;
};

export type AskResult = {
  text: string;
  provider: "openrouter" | "gemini" | "cloudflare-ai";
  model: string;
};

/* -------------------- helpers -------------------- */
function getEnvKey(env: AskEnv, ...names: (keyof AskEnv)[]): string | undefined {
  for (const n of names) {
    const v = (env as any)?.[n];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function trimHistory(history: ChatTurn[] | undefined, keepTurns = 6): ChatTurn[] {
  if (!history?.length) return [];
  // забираємо system, щоби він не дублікувався (ми підставимо власний нижче)
  const onlyUA = history.filter(h => h.role === "user" || h.role === "assistant");
  const slice = onlyUA.slice(-keepTurns * 2); // user+assistant пари
  return slice;
}

function buildOpenAIMessages(opts: AskOptions, prompt: string) {
  const msgs: { role: "system" | "user" | "assistant"; content: string }[] = [];
  if (opts.systemPrompt?.trim()) msgs.push({ role: "system", content: opts.systemPrompt.trim() });
  for (const h of trimHistory(opts.history, opts.historyTurns ?? 6)) {
    msgs.push({ role: h.role, content: h.content });
  }
  msgs.push({ role: "user", content: prompt });
  return msgs;
}

function buildGeminiContents(opts: AskOptions, prompt: string) {
  // Gemini expects: { contents: [{role, parts:[{text}]}], systemInstruction?: {parts:[{text}]}}
  const contents: any[] = [];
  for (const h of trimHistory(opts.history, opts.historyTurns ?? 6)) {
    contents.push({
      role: h.role === "assistant" ? "model" : "user",
      parts: [{ text: h.content }],
    });
  }
  contents.push({ role: "user", parts: [{ text: prompt }] });

  const body: any = {
    contents,
    generationConfig: {
      maxOutputTokens: opts.maxTokens ?? 512,
      temperature: opts.temperature ?? 0.6,
    },
  };
  if (opts.systemPrompt?.trim()) {
    body.systemInstruction = { parts: [{ text: opts.systemPrompt.trim() }] };
  }
  return body;
}

/* -------------------- OpenRouter -------------------- */
async function askOpenRouter(
  env: AskEnv,
  prompt: string,
  signal: AbortSignal,
  opts: AskOptions
): Promise<AskResult> {
  const key = getEnvKey(env, "OPENROUTER_API_KEY", "OR_API_KEY");
  if (!key) throw new Error("no-openrouter-key");

  const candidates = [
    "anthropic/claude-3.7-sonnet",
    "anthropic/claude-3.5-sonnet",
    "deepseek/deepseek-chat",
    "meta-llama/llama-3.1-405b-instruct",
  ];

  const messages = buildOpenAIMessages(opts, prompt);
  const max_tokens = opts.maxTokens ?? 512;
  const temperature = opts.temperature ?? 0.6;

  let lastErr: any;
  for (const model of candidates) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ model, messages, max_tokens, temperature }),
      });

      if (r.status >= 500 || r.status === 429) {
        lastErr = new Error(`openrouter:${model}:${r.status}`);
        continue;
      }
      if (!r.ok) {
        lastErr = new Error(`openrouter:${model}:${r.status}`);
        continue;
      }

      const data: any = await r.json();
      const text = data?.choices?.[0]?.message?.content?.toString?.() ?? "";
      if (!text) throw new Error("openrouter-empty");
      return { text, provider: "openrouter", model };
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw lastErr || new Error("openrouter-failed");
}

/* -------------------- Gemini -------------------- */
async function askGemini(
  env: AskEnv,
  prompt: string,
  signal: AbortSignal,
  opts: AskOptions
): Promise<AskResult> {
  const key = getEnvKey(env, "GEMINI_API_KEY", "GOOGLE_API_KEY");
  if (!key) throw new Error("no-gemini-key");

  const models = [
    "models/gemini-2.0-flash",
    "models/gemini-2.0-flash-lite",
    "models/gemini-1.5-flash",
  ];

  const baseBody = buildGeminiContents(opts, prompt);

  let lastErr: any;
  for (const model of models) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${encodeURIComponent(
          key
        )}`,
        {
          method: "POST",
          signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(baseBody),
        }
      );

      if (r.status >= 500 || r.status === 429) {
        lastErr = new Error(`gemini:${model}:${r.status}`);
        continue;
      }
      if (!r.ok) {
        lastErr = new Error(`gemini:${model}:${r.status}`);
        continue;
      }

      const data: any = await r.json();
      const text =
        data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join("\n") ??
        data?.candidates?.[0]?.content?.parts?.[0]?.text ??
        "";
      if (!text) throw new Error("gemini-empty");
      return { text, provider: "gemini", model };
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw lastErr || new Error("gemini-failed");
}

/* -------------------- Cloudflare Workers AI -------------------- */
async function askCloudflare(
  env: AskEnv,
  prompt: string,
  signal: AbortSignal,
  opts: AskOptions
): Promise<AskResult> {
  const models = [
    "@cf/meta/llama-3.1-70b-instruct",
    "@cf/meta/llama-3.1-8b-instruct",
  ];

  const messages = buildOpenAIMessages(opts, prompt);
  const max_tokens = opts.maxTokens ?? 512;
  const temperature = opts.temperature ?? 0.6;

  let lastErr: any;
  for (const model of models) {
    try {
      const r: any = await (env.AI as any).run(
        model,
        { messages, max_tokens, temperature },
        { signal } as any
      );
      const text =
        (r?.response ?? r?.result?.response ?? r?.output_text ?? "").toString();
      if (!text) throw new Error("cf-empty");
      return { text, provider: "cloudflare-ai", model };
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw lastErr || new Error("cloudflare-failed");
}

/* -------------------- Публічна функція -------------------- */
export async function smartAsk(
  env: AskEnv,
  prompt: string,
  options: AskOptions = {}
): Promise<AskResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("ask-timeout"), 25_000);

  try {
    // 1) OpenRouter — якщо є ключ
    if (getEnvKey(env, "OPENROUTER_API_KEY", "OR_API_KEY")) {
      try {
        return await askOpenRouter(env, prompt, controller.signal, options);
      } catch {}
    }
    // 2) Gemini — якщо є ключ
    if (getEnvKey(env, "GEMINI_API_KEY", "GOOGLE_API_KEY")) {
      try {
        return await askGemini(env, prompt, controller.signal, options);
      } catch {}
    }
    // 3) Workers AI — завжди доступний у воркері
    return await askCloudflare(env, prompt, controller.signal, options);
  } finally {
    clearTimeout(timeout);
  }
}