// src/ai/providers.ts
// Єдині точки інтеграції з ШІ-провайдерами + спільні утиліти

export type AIResult =
  | { ok: true; text: string; provider: string }
  | { ok: false; provider: string; error: string; retryable: boolean };

export interface Provider {
  name: string;
  call: (env: Env, prompt: string, signal: AbortSignal) => Promise<AIResult>;
  // Чи ввімкнений провайдер (напр. немає ключа — вимикаємо)
  enabled: (env: Env) => boolean;
}

// ---- helpers ---------------------------------------------------------------

const toAIError = (provider: string, e: unknown, retryable = true): AIResult => {
  const msg =
    e instanceof Error ? `${e.name}: ${e.message}` : typeof e === "string" ? e : "Unknown error";
  // Деякі тексти помилок не варто ретраїти (400/401/403)
  const m = msg.toLowerCase();
  const hard =
    m.includes("401") || m.includes("unauthorized") ||
    m.includes("403") || m.includes("forbidden") ||
    m.includes("invalid") || m.includes("bad request") ||
    m.includes("unsupported");
  return { ok: false, provider, error: msg, retryable: retryable && !hard };
};

// таймаут для будь-якого провайдера (захист від «зависань»)
export const withTimeout = async <T>(
  ms: number,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort("timeout"), ms);
  try {
    return await task(ctrl.signal);
  } finally {
    clearTimeout(t);
  }
};

// компактний вирівнювач пробілів
export const normalize = (s: string) =>
  s.replace(/\s+/g, " ").replace(/^[\s\r\n]+|[\s\r\n]+$/g, "");

// ---- Gemini (Google) -------------------------------------------------------

async function callGemini(env: Env, prompt: string, signal: AbortSignal): Promise<AIResult> {
  try {
    const key = env.GEMINI_API_KEY;
    // Можна змінити модель за бажанням
    const model = "gemini-1.5-flash";
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
        }),
      },
    );
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${t}`);
    }
    const data = await res.json();
    const text: string =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).join("") ?? "";
    if (!text) throw new Error("Empty response");
    return { ok: true, text: normalize(text), provider: "gemini" };
  } catch (e) {
    return toAIError("gemini", e);
  }
}

const Gemini: Provider = {
  name: "gemini",
  enabled: (env) => Boolean(env.GEMINI_API_KEY),
  call: callGemini,
};

// ---- Groq (Llama/Mixtral) --------------------------------------------------

async function callGroq(env: Env, prompt: string, signal: AbortSignal): Promise[AIResult] {
  try {
    const key = env.GROQ_API_KEY;
    const model = "llama-3.1-70b-versatile";
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
    const j = await res.json();
    const text: string = j?.choices?.[0]?.message?.content ?? "";
    if (!text) throw new Error("Empty response");
    return { ok: true, text: normalize(text), provider: "groq" };
  } catch (e) {
    return toAIError("groq", e);
  }
}

const Groq: Provider = {
  name: "groq",
  enabled: (env) => Boolean(env.GROQ_API_KEY),
  call: callGroq,
};

// ---- OpenRouter (агрегатор моделей) ---------------------------------------

async function callOpenRouter(env: Env, prompt: string, signal: AbortSignal): Promise<AIResult> {
  try {
    const key = env.OPENROUTER_API_KEY;
    // Дозволяємо задати модель через секрет OPENROUTER_MODEL
    const model = env.OPENROUTER_MODEL || "google/gemma-2-9b-it";
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        "HTTP-Referer": "https://restSVA.workers.dev", // будь-який валідний реферер
        "X-Title": "Senti Bot",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
    const j = await res.json();
    const text: string = j?.choices?.[0]?.message?.content ?? "";
    if (!text) throw new Error("Empty response");
    return { ok: true, text: normalize(text), provider: `openrouter:${model}` };
  } catch (e) {
    return toAIError("openrouter", e);
  }
}

const OpenRouter: Provider = {
  name: "openrouter",
  enabled: (env) => Boolean(env.OPENROUTER_API_KEY),
  call: callOpenRouter,
};

// ---- DeepSeek --------------------------------------------------------------

async function callDeepSeek(env: Env, prompt: string, signal: AbortSignal): Promise<AIResult> {
  try {
    const key = env.DEEPSEEK_API_KEY;
    const model = "deepseek-chat";
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
    const j = await res.json();
    const text: string = j?.choices?.[0]?.message?.content ?? "";
    if (!text) throw new Error("Empty response");
    return { ok: true, text: normalize(text), provider: "deepseek" };
  } catch (e) {
    return toAIError("deepseek", e);
  }
}

const DeepSeek: Provider = {
  name: "deepseek",
  enabled: (env) => Boolean(env.DEEPSEEK_API_KEY),
  call: callDeepSeek,
};

// ---- експорт списку провайдерів за замовчуванням ---------------------------

/**
 * Порядок = пріоритет фейловеру. Можна змінити в одному місці.
 * Провайдер виключається автоматично, якщо немає ключа в Env.
 */
export const DefaultProviders: Provider[] = [Gemini, Groq, OpenRouter, DeepSeek];