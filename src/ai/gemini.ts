// src/ai/gemini.ts

import { composeSystemInstruction, type Lang } from "../utils/i18n";

export interface Env {
  GEMINI_API_KEY?: string;
}

/** Додаткова коротка стилістична підказка (однакова для всіх моделей) */
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

/** Прибираємо преамбули/мовні коментарі, що іноді проскакують */
function sanitizeAnswer(text: string): string {
  const lines = (text || "").split(/\r?\n/);
  const dropPatterns: RegExp[] = [
    // AI преамбули
    /^\s*i['’]?m an ai.*$/i,
    /^\s*as an ai.*$/i,
    /^\s*я\s+штучний\s+інтелект.*$/i,
    /^\s*как\s+искусственный\s+интеллект.*$/i,
    /^\s*als\s+ki.*$/i,
    // мовні коментарі
    /\bпо(-|\s)?(рус|українськ|немецк|німецьк|английск|англійськ)\b/i,
    /\b(in|auf)\s+(english|englisch|deutsch|russian|ukrainian)\b/i,
  ];
  const filtered = lines.filter((l) => !dropPatterns.some((re) => re.test(l)));
  return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Виклик Gemini для текстової відповіді з жорсткою мовною інструкцією.
 */
export async function geminiAskText(
  env: Env,
  prompt: string,
  lang: Lang,
): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  const model = "gemini-2.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
    env.GEMINI_API_KEY,
  )}`;

  const systemInstruction = `${composeSystemInstruction(lang)}\n${styleHint(lang)}`;

  // Дублюємо короткий guard на початку промпта як страховку
  const reinforcedPrompt =
    `${systemInstruction}\n\n` +
    `Відповідай згідно інструкції вище.\n\n` +
    prompt;

  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [
      {
        role: "user",
        parts: [{ text: reinforcedPrompt }],
      },
    ],
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let data: any = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Gemini: bad JSON from upstream${raw ? ` — ${raw.slice(0, 180)}` : ""}`);
  }

  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Gemini error: ${msg}`);
  }

  // Модераційний блок
  const block = data?.promptFeedback?.blockReason;
  if (block) throw new Error(`Gemini blocked: ${block}`);

  // Витягуємо всі текстові parts усіх кандидатів
  const texts: string[] = [];
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  for (const c of candidates) {
    const parts = Array.isArray(c?.content?.parts) ? c.content.parts : [];
    for (const p of parts) {
      if (typeof p?.text === "string" && p.text.trim()) texts.push(p.text);
    }
  }

  const out = sanitizeAnswer(texts.join("\n").trim());
  if (!out) throw new Error("Gemini returned no text");

  return out;
}