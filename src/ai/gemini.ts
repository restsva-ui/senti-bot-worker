// src/ai/gemini.ts

export interface Env {
  GEMINI_API_KEY?: string;
}

/** Дуже проста евристика визначення мови запиту */
function detectLang(prompt: string): "uk" | "ru" | "en" {
  const hasUk = /[іІїЇєЄґҐ]/.test(prompt);
  const hasCyr = /[а-яА-ЯёЁ]/.test(prompt);
  if (hasUk) return "uk";
  if (hasCyr) return "ru";
  return "en";
}

/** Повідомлення-інструкція для бажаної мови відповіді */
function languageInstruction(lang: "uk" | "ru" | "en"): string {
  switch (lang) {
    case "uk":
      return "Відповідай українською мовою. Якщо проситимуть іншу мову — перемикайся.";
    case "ru":
      return "Отвечай на том же языке, что и пользователь. Сейчас — по-русски.";
    default:
      return "Answer in the same language as the user. Default to English.";
  }
}

/**
 * Простий виклик Gemini для текстової відповіді.
 * За замовчуванням використовує стабільний gemini-2.0-flash.
 * Додаємо інструкцію щодо мови у контент користувача (найбезпечніше для API).
 */
export async function geminiAskText(env: Env, prompt: string): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  const model = "gemini-2.0-flash"; // швидкий і недорогий
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
    env.GEMINI_API_KEY,
  )}`;

  const lang = detectLang(prompt);
  const instruction = languageInstruction(lang);

  const body = {
    contents: [
      // даємо коротку інструкцію перед самим промптом
      {
        role: "user",
        parts: [{ text: instruction }],
      },
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const txt = await r.text();
  if (!txt) throw new Error("Gemini empty response");

  let json: any;
  try {
    json = JSON.parse(txt);
  } catch {
    throw new Error("Gemini bad JSON");
  }

  // очікуваний формат: candidates[0].content.parts[].text
  const parts: string[] =
    json?.candidates?.[0]?.content?.parts
      ?.map((p: any) => (typeof p?.text === "string" ? p.text : ""))
      ?.filter((s: string) => s.length > 0) ?? [];

  if (parts.length === 0) {
    const err = json?.promptFeedback?.blockReason || json?.error?.message;
    throw new Error(err || "Gemini returned no text");
  }

  return parts.join("\n");
}