// src/ai/openrouter.ts
import type { Env } from "../index";
import { composeSystemInstruction, type Lang } from "../utils/i18n";

const OR_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openrouter/auto";

export async function openrouterAskText(
  env: Env,
  user: string,
  lang: Lang,
): Promise<string> {
  const key = env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is missing");

  const system = composeSystemInstruction(lang);

  const body = {
    model: DEFAULT_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `${system}\n\n${user}` }, // дублюємо як легку страховку
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

  const raw = await res.text();
  if (!res.ok) throw new Error(`OpenRouter error ${res.status}: ${raw}`);

  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }

  const text: string =
    data?.choices?.[0]?.message?.content ??
    (Array.isArray(data?.choices) ? data.choices.map((c: any) => c?.message?.content).filter(Boolean).join("\n") : "");

  return (text || "(empty response)").trim();
}