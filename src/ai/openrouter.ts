// src/ai/openrouter.ts
/**
 * Обгортка для OpenRouter Chat Completions з підтримкою system-повідомлення
 * та мовної інструкції.
 */
import type { Env } from "../index";
import { languageInstruction, type Lang } from "../utils/i18n";

const OR_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openrouter/auto"; // можна замінити на інший при бажанні

export async function openrouterAskText(
  env: Env,
  user: string,
  lang: Lang,
): Promise<string> {
  const key = env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is missing");

  // Системна інструкція на потрібній мові
  const system = languageInstruction(lang);

  const body = {
    model: DEFAULT_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.7,
  };

  const res = await fetch(OR_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://workers.cloudflare.com",
      "X-Title": "Senti Bot",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${txt}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  return String(text || "").trim() || "(empty response)";
}