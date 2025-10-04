// src/ai/openrouter.ts
/**
 * Уніфікована обгортка OpenRouter Chat Completions з тією ж мовною інструкцією,
 * що й у Gemini. Відповіді повинні бути однаково дружні та без мовних коментарів.
 */
import type { Env } from "../index";
import { composeSystemInstruction, type Lang } from "../utils/i18n";

/** Коротка стилістична підказка — така ж, як у gemini.ts */
function styleHint(lang: Lang): string {
  switch (lang) {
    case "uk":
      return "Пиши коротко, дружньо й по суті. Без канцеляризмів. Для списків — маркери.";
    case "ru":
      return "Пиши коротко, дружелюбно и по делу. Без канцелярита. Для списков — маркеры.";
    case "de":
      return "Schreibe kurz, freundlich und auf den Punkt. Keine Amtsfloskeln. Für Listen: Aufzählungen.";
    case "en":
    default:
      return "Write briefly, friendly, and to the point. No corporate jargon. Use bullets for lists.";
  }
}

/** Санітизуємо відповідь від AI-преамбул і мовних ремарок */
function sanitizeAnswer(text: string): string {
  const lines = (text || "").split(/\r?\n/);
  const dropPatterns: RegExp[] = [
    /^\s*i['’]?m an ai.*$/i,
    /^\s*as an ai.*$/i,
    /^\s*я\s+штучний\s+інтелект.*$/i,
    /^\s*как\s+искусственный\s+интеллект.*$/i,
    /^\s*als\s+ki.*$/i,
    /\bпо(-|\s)?(рус|українськ|немецк|німецьк|английск|англійськ)\b/i,
    /\b(in|auf)\s+(english|englisch|deutsch|russian|ukrainian)\b/i,
  ];
  const filtered = lines.filter((l) => !dropPatterns.some((re) => re.test(l)));
  return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const OR_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openrouter/auto";

/** Вибір моделі з env або дефолт */
function pickModel(env: Env): string {
  // підтримуємо кілька назв змінних оточення
  const fromEnv =
    (env as any).OPENROUTER_MODEL ||
    (env as any).OR_MODEL ||
    "";
  return String(fromEnv || DEFAULT_MODEL);
}

export async function openrouterAskText(
  env: Env,
  userPrompt: string,
  lang: Lang,
): Promise<string> {
  const key = env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is missing");

  const system = `${composeSystemInstruction(lang)}\n${styleHint(lang)}`;

  // Підсилюємо інструкцію в user-повідомленні аналогічно Gemini
  const reinforced = `${system}\n\nВідповідай згідно інструкції вище.\n\n${userPrompt}`;

  const body = {
    model: pickModel(env),
    messages: [
      { role: "system", content: system },
      { role: "user", content: reinforced },
    ],
    temperature: 0.4, // трохи знижено для більш стабільних, лаконічних відповідей
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
  let data: any = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`OpenRouter: bad JSON${raw ? ` — ${raw.slice(0, 180)}` : ""}`);
  }

  if (!res.ok) {
    const err = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`OpenRouter error: ${err}`);
  }

  const text =
    data?.choices?.[0]?.message?.content ??
    (Array.isArray(data?.choices) ? data.choices.map((c: any) => c?.message?.content || "").join("\n") : "");

  const out = sanitizeAnswer(String(text || "").trim());
  if (!out) throw new Error("OpenRouter returned no text");

  return out;
}