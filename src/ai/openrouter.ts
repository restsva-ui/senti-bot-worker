// src/ai/openrouter.ts
/**
 * OpenRouter Chat Completions з підтримкою system-повідомлення,
 * правил "рядок-у-рядок" і дружніх коротких відповідей.
 */
import type { Env as RootEnv } from "../index";
import { languageInstruction, type Lang } from "../utils/i18n";

const OR_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openrouter/auto";

/** Стильові інструкції як у gemini.ts */
function styleInstruction(lang: Lang): string {
  switch (lang) {
    case "uk":
      return "Пиши природно й дружньо: короткі речення, розмовний тон, без канцеляризмів. Не згадуй, що ти ШІ. Якщо просять список — використовуй маркери.";
    case "ru":
      return "Пиши естественно и дружелюбно: короткие фразы, простой разговорный тон, без канцеляризмов. Не упоминай, что ты ИИ. Если просят список — используй маркеры.";
    case "de":
      return "Schreibe locker und freundlich: kurze Sätze, natürlicher Ton, ohne Amtsdeutsch. Erwähne nicht, dass du KI bist. Für Listen nutze Aufzählungen.";
    case "en":
    default:
      return "Write naturally and friendly: short sentences, conversational tone, no corporate jargon. Do not say you are an AI. Use bullet points for lists.";
  }
}

/** Санітизатор: зрізає службові преамбули/розділювачі */
function sanitizeAnswer(text: string, lang: Lang): string {
  const lines = String(text || "").split(/\r?\n/);

  const patterns: RegExp[] = [
    /^\s*i['’]m an ai.*$/i,
    /^\s*as an ai.*$/i,
    /^\s*answer(s)?\s+to\b.*$/i,
    /^\s*here (are|is) (my|the) answer(s)?\b.*$/i,
    /^\s*я\s+штучний\s+інтелект.*$/i,
    /^\s*як\s+штучний\s+інтелект[, ]/i,
    /^\s*я\s+являюсь\s+искусственным\s+интеллектом.*$/i,
    /^\s*как\s+ии[, ]/i,
    /^\s*als\s+ki[, ]/i,
    /^\s*ich\s+bin\s+eine\s+ki.*$/i,
    /^\s*ось\s+мо[їі]\s+відповід[іії].*$/i,
    /^\s*відповід(ь|і)\s+на\s+.*$/i,
    /^\s*ответ(ы)?\s+на\s+.*$/i,
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

  // Системна інструкція: мова + стиль + правила пакетних рядків
  const batchRules =
    "Якщо у вхідному тексті кілька рядків, відповідай на КОЖЕН рядок окремо, зберігаючи порядок. " +
    "Не використовуй заголовки/преамбули/цитування, розділювачі типу --- або ***. " +
    "Кожна відповідь має бути природною короткою реплікою (1–2 дружні прості речення), а не просто слово.";
  const system = `${languageInstruction(lang)}\n${styleInstruction(lang)}\n${batchRules}`;

  const body = {
    model: DEFAULT_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `${user}` },
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