// src/ai/providers.ts
// Єдине місце для звернень до зовнішніх AI-провайдерів
// і стандартних JSON-відповідей ok/err.

export type TextProvider = "gemini" | "openrouter";

export function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, status, data }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function err(error: unknown, status = 400): Response {
  const message =
    typeof error === "string"
      ? error
      : (error as any)?.message || String(error);
  return new Response(JSON.stringify({ ok: false, status, error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Gemini: простий text completion
export async function geminiText(
  env: any,
  prompt: string,
  model = "models/gemini-2.5-flash"
) {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY");

  const url = `https://generativelanguage.googleapis.com/v1beta/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(key)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    }),
  });
  const raw = await res.json();
  if (!res.ok) throw new Error(raw?.error?.message || res.statusText);

  const parts = raw?.candidates?.[0]?.content?.parts || [];
  const text =
    parts.map((p: any) => p?.text).filter(Boolean).join("") ||
    raw?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "";

  return { text, raw };
}

// Gemini: список моделей
export async function geminiListModels(env: any) {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY");

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
    key
  )}`;
  const res = await fetch(url);
  const raw = await res.json();
  if (!res.ok) throw new Error(raw?.error?.message || res.statusText);

  return { models: raw?.models || [], raw };
}

// ──────────────────────────────────────────────────────────────────────────────
// OpenRouter: text completion
export async function openrouterText(
  env: any,
  prompt: string,
  model = "deepseek/deepseek-chat"
) {
  const key = env.OPENROUTER_API_KEY;
  if (!key) throw new Error("Missing OPENROUTER_API_KEY");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${key}`,
      // невимогливо, але корисно для лімітів OR
      "HTTP-Referer": "https://workers.dev",
      "X-Title": "senti-bot-worker",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const raw = await res.json();
  if (!res.ok) throw new Error(raw?.error?.message || res.statusText);

  const text = raw?.choices?.[0]?.message?.content || "";
  return { text, raw };
}

// ──────────────────────────────────────────────────────────────────────────────
// Уніфікований роутер для текстових провайдерів
export async function aiTextRouter(
  env: any,
  provider: TextProvider,
  prompt: string,
  model?: string
) {
  if (provider === "gemini") return geminiText(env, prompt, model);
  if (provider === "openrouter") return openrouterText(env, prompt, model);
  throw new Error(`Unsupported provider: ${provider}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// CF Workers AI Vision (наприклад @cf/llava-hf/llava-1.5-7b)
// Очікуємо, що env.CF_VISION = "@"-шлях моделі, напр. "@cf/llava-hf/llava-1.5-7b"
export async function cfVision(env: any, imageUrl: string, prompt: string) {
  const token = env.CLOUDFLARE_API_TOKEN;
  const model = env.CF_VISION || "@cf/llava-hf/llava-1.5-7b";
  if (!token) throw new Error("Missing CLOUDFLARE_API_TOKEN");

  // 1) Дістаємо account id (cid) з verify, якщо не заданий явно
  let accountId = env.CF_ACCOUNT_ID;
  if (!accountId) {
    const verify = await fetch(
      "https://api.cloudflare.com/client/v4/user/tokens/verify",
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const vj = await verify.json();
    accountId = vj?.result?.cid || vj?.result?.account_id;
    if (!accountId) throw new Error("Cannot resolve Cloudflare Account ID");
  }

  // 2) Викликаємо AI run
  const runUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  const res = await fetch(runUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      // формат для LLaVA-сумісних моделей
      prompt,
      image: [imageUrl],
    }),
  });

  const raw = await res.json();
  if (!res.ok) {
    const msg = raw?.errors?.[0]?.message || res.statusText;
    throw new Error(msg);
  }

  const text =
    raw?.result?.response ||
    raw?.result?.description ||
    raw?.result?.text ||
    "";

  return { text, raw };
}