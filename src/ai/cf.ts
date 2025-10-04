// src/ai/cf.ts
// Проста обгортка для Cloudflare Workers AI (текстовий інференс).

export interface CfEnv {
  CLOUDFLARE_ACCOUNT_ID?: string;
  CF_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CF_API_TOKEN?: string;
}

/** Модель за замовчуванням — дешева/швидка інструкційна. */
export const DEFAULT_CF_MODEL = "@cf/meta/llama-3.1-8b-instruct";

/**
 * Викликає Workers AI з prompt і повертає текст відповіді.
 * Кидає помилку з читабельним повідомленням, якщо щось не так.
 */
export async function askCloudflareAI(env: CfEnv, prompt: string, model = DEFAULT_CF_MODEL): Promise<string> {
  const accountId =
    (env.CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_ID || "").trim();
  const apiToken =
    (env.CLOUDFLARE_API_TOKEN || (env as any).CF_API_TOKEN || "").trim();

  if (!accountId || !apiToken) {
    throw new Error(
      "Cloudflare AI не налаштовано: додай CLOUDFLARE_ACCOUNT_ID та CLOUDFLARE_API_TOKEN у Variables/Secrets."
    );
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encodeURIComponent(
    model
  )}`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "content-type": "application/json",
    },
    // Для інструкційних моделей достатньо {prompt}. (Підтримується unified "messages" також.)
    body: JSON.stringify({ prompt }),
  });

  const text = await r.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }

  if (!r.ok) {
    const msg =
      body?.errors?.[0]?.message ||
      body?.error ||
      `HTTP ${r.status}`;
    throw new Error(`Cloudflare AI error: ${msg}`);
  }

  const result = body?.result ?? body;
  const response =
    (typeof result?.response === "string" && result.response) ||
    (typeof result?.output_text === "string" && result.output_text) ||
    "";

  return response || "(порожня відповідь моделі)";
}