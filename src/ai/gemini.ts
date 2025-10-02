// src/ai/gemini.ts
import { composeSystemInstruction, type Lang } from "../utils/i18n";

export interface Env {
  GEMINI_API_KEY?: string;
}

/** Прибираємо мета-преамбули (I'm an AI… тощо). */
function sanitizeAnswer(text: string): string {
  const lines = text.split(/\r?\n/);
  const patterns: RegExp[] = [
    /^\s*i['’]m an ai.*$/i,
    /^\s*as an ai.*$/i,
    /^\s*я\s+штучний\s+інтелект.*$/i,
    /^\s*як\s+штучний\s+інтелект[, ]/i,
    /^\s*как\s+искусственный\s+интеллект[, ]/i,
    /^\s*als\s+ki[, ]/i,
    /^\s*ich\s+bin\s+eine\s+ki.*$/i,
  ];
  const filtered = lines.filter((l) => !patterns.some((re) => re.test(l)));
  return filtered.join("\n").trim().replace(/\n{3,}/g, "\n\n");
}

/** Текстова відповідь від Gemini з однаковою системною інструкцією. */
export async function geminiAskText(
  env: Env,
  prompt: string,
  lang: Lang,
): Promise<string> {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

  const model = "gemini-2.5-flash";
  const sys = composeSystemInstruction(lang);
  const reinforced = `${sys}\n\n${prompt}`;

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=` +
    encodeURIComponent(env.GEMINI_API_KEY);

  const body = {
    systemInstruction: { parts: [{ text: sys }] },
    contents: [{ role: "user", parts: [{ text: reinforced }] }],
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
    throw new Error(`Gemini: bad JSON${raw ? ` — ${raw.slice(0, 160)}` : ""}`);
  }

  if (!res.ok) {
    const err = json?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Gemini error: ${err}`);
  }

  const block = json?.promptFeedback?.blockReason;
  if (block) throw new Error(`Gemini blocked: ${block}`);

  const parts: string[] = [];
  for (const c of json?.candidates || []) {
    for (const p of c?.content?.parts || []) {
      if (typeof p?.text === "string" && p.text.trim()) parts.push(p.text);
    }
  }
  const answer = (parts.join("\n").trim()) || "(empty response)";
  return sanitizeAnswer(answer);
}