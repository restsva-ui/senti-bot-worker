// src/ai/openrouter.ts
/**
 * Обгортка для OpenRouter Chat Completions з підтримкою system-повідомлення,
 * правил "рядок-у-рядок" і санітизації відповіді.
 */
import type { Env as RootEnv } from "../index";
import { languageInstruction, type Lang } from "../utils/i18n";

const OR_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openrouter/auto";

/** Стильові інструкції як у gemini.ts (коротко й по-людськи). */
function styleInstruction(lang: Lang): string {
  switch (lang) {
    case "uk":
      return "Пиши природно й дружньо: короткі речення, розмовний тон, без канцеляризмів. Не згадуй, що ти ШІ. Якщо просять список — використовуй маркери.";
    case "ru":
      return "Пиши естественно и дружелюбно: короткие фразы, разговорный тон, без канцеляризмов. Не упоминай, что ты ИИ. Если просят список — используй маркеры.";
    case "de":
      return "Schreibe natürlich und freundlich: kurze Sätze, lockerer Ton, ohne Amtsdeutsch. Erwähne nicht, dass du eine KI bist. Für Listen nutze Aufzählungen.";
    case "en":
    default:
      return "Write naturally and friendly: short sentences, conversational tone, no corporate jargon. Do not say you are an AI. Use bullet points for lists.";
  }
}

/** Санітизатор: зрізає преамбули/заголовки/розділювачі. */
function sanitizeAnswer(text: string, lang: Lang): string {
  const lines = String(text || "").split(/\r?\n/);

  const patterns: RegExp[] = [
    // EN
    /^\s*i['’]m an ai.*$/i,
    /^\s*as an ai.*$/i,
    /^\s*answer(s)?\s+to\b.*$/i,
    /^\s*here (are|is) (my|the) answer(s)?\b.*$/i,
    // RU
    /^\s*я\s+являюсь\s+искусственным\s+интеллектом.*$/i,
    /^\s*как\s+ии[, ]/i,
    /^\s*ответ(ы)?\s+на\s+.*$/i,
    // UK
    /^\s*я\s+штучний\s+інтелект.*$/i,
    /^\s*як\s+штучний\s+інтелект[, ]/i,
    /^\s*відповід(ь|і)\s+на\s+.*$/i,
    /^\s*ось\s+мо[їі]\s+відповід[іії].*$/i,
    // DE
    /^\s*als\s+ki[, ]/i,
    /^\s*ich\s+bin\s+eine\s+ki.*$/i,
    /^\s*antwort(en)?\s+auf\s+.*$/i,
    // розділювачі
    /^\s*[-–—*_]{3,}\s*$/,
  ];

  const filtered = lines.filter((l) => !patterns.some((re) => re.test(l)));
  return filtered.join("\n").trim().replace(/\n{3,}/g, "\n\n");
}

export async function openrouterAskText(
  env: RootEnv,
  user: string,
  lang: Lang,
): Promise<string> {
  const key = env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is missing");

  // Системна інструкція на потрібній мові + стиль + правила пакетних рядків
  const batchRules =
    "Якщо у вхідному тексті кілька рядків, відповідай на КОЖЕН рядок окремою короткою відповіддю у тому ж порядку. " +
    "Заборонено будь-які заголовки/преамбули/цитування, фрази на кшталт «Ось мої відповіді…» чи «Відповідь на …», " +
    "а також розділювачі типу --- або ***. Просто поверни відповіді рядок-у-рядок.";
  const system = `${languageInstruction(lang)}\n${styleInstruction(lang)}\n${batchRules}`;

  const body = {
    model: DEFAULT_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `${system}\n\n${user}` }, // страховка: дублюємо коротко в prompt
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
  let data: any = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`OpenRouter bad JSON${raw ? ` — ${raw.slice(0, 160)}` : ""}`);
  }

  if (!res.ok) {
    const txt = data?.error?.message || raw || `HTTP ${res.status}`;
    throw new Error(`OpenRouter error ${res.status}: ${txt}`);
  }

  const text =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.map((c: any) => c?.message?.content).filter(Boolean).join("\n") ??
    "";

  return sanitizeAnswer(text, lang) || "(empty response)";
}