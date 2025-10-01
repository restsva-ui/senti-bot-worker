// src/ai/openrouter.ts

export interface Env {
  OPENROUTER_API_KEY?: string;
}

/** Дуже проста евристика визначення мови запиту */
function detectLang(prompt: string): "uk" | "ru" | "en" {
  const hasUk = /[іІїЇєЄґҐ]/.test(prompt);
  const hasCyr = /[а-яА-ЯёЁ]/.test(prompt);
  if (hasUk) return "uk";
  if (hasCyr) return "ru";
  return "en";
}

function languageSystem(lang: "uk" | "ru" | "en"): string {
  switch (lang) {
    case "uk":
      return "Відповідай українською мовою. Коротко і чітко, без зайвої балаканини.";
    case "ru":
      return "Отвечай по-русски. Кратко и по делу.";
    default:
      return "Answer in the user's language. Default to concise English.";
  }
}

/**
 * Запит через OpenRouter. model=openrouter/auto — стабільний варіант.
 * Додаємо system-повідомлення з інструкцією щодо мови.
 */
export async function openrouterAskText(
  env: Env,
  prompt: string,
): Promise<string> {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is missing");
  }

  const url = "https://openrouter.ai/api/v1/chat/completions";
  const lang = detectLang(prompt);

  const body = {
    model: "openrouter/auto",
    messages: [
      { role: "system", content: languageSystem(lang) },
      { role: "user", content: prompt },
    ],
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://github.com/restsva/senti-bot-worker",
      "X-Title": "Senti Bot",
    },
    body: JSON.stringify(body),
  });

  const txt = await r.text();
  if (!txt) throw new Error("OpenRouter empty response");

  let json: any;
  try {
    json = JSON.parse(txt);
  } catch {
    throw new Error("OpenRouter bad JSON");
  }

  const content: string | undefined = json?.choices?.[0]?.message?.content;
  if (!content) {
    const err =
      json?.error?.message || json?.message || "OpenRouter returned no text";
    throw new Error(err);
  }
  return content;
}