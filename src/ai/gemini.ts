import { languageInstruction, type Lang } from "../utils/i18n";

export interface Env {
  GEMINI_API_KEY?: string;
}

/** Легасі-fallback, якщо зверху явно не передали lang. */
function legacyDetectLang(prompt: string): "uk" | "ru" | "en" {
  const hasUk = /[іІїЇєЄґҐ]/.test(prompt);
  const hasCyr = /[а-яА-ЯёЁ]/.test(prompt);
  if (hasUk) return "uk";
  if (hasCyr) return "ru";
  return "en";
}

/** Дружній стиль для кожної мови (коротко й по-людськи). */
function styleInstruction(lang: Lang): string {
  switch (lang) {
    case "uk":
      return "Пиши природно й по-людськи: короткі речення, дружній тон, без канцеляризмів. Не згадуй, що ти ШІ. Якщо просять список — дай маркери.";
    case "ru":
      return "Пиши естественно и дружелюбно: короткие фразы, простой разговорный тон, без канцеляризмов. Не упоминай, что ты ИИ. Если просят список — используй маркеры.";
    case "de":
      return "Schreibe natürlich und freundlich: kurze Sätze, lockerer Ton, ohne Amtsdeutsch. Erwähne nicht, dass du eine KI bist. Bei Listen nutze Aufzählungen.";
    case "en":
    default:
      return "Write naturally and friendly: short sentences, conversational tone, no corporate jargon. Do not say you are an AI. Use bullet points for lists.";
  }
}

/** Санітизатор відповіді: зрізає преамбули/заголовки/розділювачі. */
function sanitizeAnswer(text: string, lang: Lang): string {
  const lines = text.split(/\r?\n/);

  const patterns: RegExp[] = [
    // EN преамбули/мета
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
    // розділювачі типу --- або *** або ___
    /^\s*[-–—*_]{3,}\s*$/,
  ];

  const filtered = lines.filter((l) => !patterns.some((re) => re.test(l)));
  const cleaned = filtered.join("\n").trim();
  return cleaned.replace(/\n{3,}/g, "\n\n");
}

/**
 * Виклик Gemini для текстової відповіді.
 * - Правильне поле `systemInstruction`.
 * - Додаємо чіткі правила для пакетних рядків.
 * - Фінальна зачистка відповіді.
 */
export async function geminiAskText(
  env: Env,
  prompt: string,
  lang?: Lang,
): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  const model = "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
    env.GEMINI_API_KEY,
  )}`;

  const targetLang: Lang = (lang ?? (legacyDetectLang(prompt) as Lang)) as Lang;

  const batchRules =
    "Якщо у вхідному тексті кілька рядків, відповідай на КОЖЕН рядок окремою короткою відповіддю у тому ж порядку. " +
    "Заборонено будь-які заголовки/преамбули/цитування, фрази «Ось мої відповіді…», «Відповідь на …», розділювачі типу --- або ***.";
  const systemInstr = `${languageInstruction(targetLang)}\n${styleInstruction(targetLang)}\n${batchRules}`;
  const reinforcedPrompt = `${systemInstr}\n\n${prompt}`;

  const body: any = {
    contents: [
      {
        role: "user",
        parts: [{ text: reinforcedPrompt }],
      },
    ],
    systemInstruction: { parts: [{ text: systemInstr }] },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let json: any = {};
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Gemini: bad JSON from upstream${raw ? ` — ${raw.slice(0, 160)}` : ""}`);
  }

  if (!res.ok) {
    const err = json?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Gemini error: ${err}`);
  }

  const block = json?.promptFeedback?.blockReason;
  if (block) throw new Error(`Gemini blocked: ${block}`);

  const texts: string[] = [];
  const candidates = Array.isArray(json?.candidates) ? json.candidates : [];
  for (const c of candidates) {
    const parts = c?.content?.parts || [];
    for (const p of parts) {
      if (typeof p?.text === "string" && p.text.trim()) {
        texts.push(p.text);
      }
    }
  }

  const answer = (texts.join("\n").trim() || "");
  if (!answer) throw new Error("Gemini returned no text");

  return sanitizeAnswer(answer, targetLang);
}