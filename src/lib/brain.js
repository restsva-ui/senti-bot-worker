// src/lib/brain.js
// "Мозок" Senti: тепер вміє працювати через MODEL_ORDER (gemini/cf/openrouter)
// і підтримує як GOOGLE_API_KEY, так і GEMINI_API_KEY.

import { askAnyModel } from "./modelRouter.js";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent";

export async function think(env, userText, systemHint = "") {
  const text = String(userText || "").trim();
  if (!text) return "🤖 Дай мені текст або запитання — і я відповім.";

  const combined = systemHint ? `${systemHint}\n\n${text}` : text;

  // 0) Якщо задано MODEL_ORDER — використовуємо універсальний роутер
  if (env.MODEL_ORDER) {
    try {
      const out = await askAnyModel(env, combined, { temperature: 0.4, max_tokens: 1024 });
      if (out) return out;
    } catch (e) {
      // впадемо у локальні запасні варіанти нижче
      console.log("modelRouter fail:", e?.message || e);
    }
  }

  // 1) Пряма спроба Gemini (читає GOOGLE_API_KEY або GEMINI_API_KEY)
  const gemKey = env.GOOGLE_API_KEY || env.GEMINI_API_KEY;
  if (gemKey) {
    try {
      const body = {
        contents: [{ role: "user", parts: [{ text: combined }]}],
        generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
      };
      const r = await fetch(`${GEMINI_URL}?key=${gemKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      const out =
        j?.candidates?.[0]?.content?.parts?.[0]?.text ??
        "";
      if (r.ok && out) return out;
      console.log("Gemini direct fail:", j);
    } catch (e) {
      console.log("Gemini direct error:", e);
    }
  }

  // 2) Резерв: OpenRouter (якщо є ключ)
  if (env.OPENROUTER_API_KEY) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: env.OPENROUTER_MODEL || "google/gemini-flash-1.5",
          messages: [{ role: "user", content: combined }],
          temperature: 0.4,
          max_tokens: 1024,
        }),
      });
      const j = await r.json().catch(() => ({}));
      const out = j?.choices?.[0]?.message?.content;
      if (r.ok && out) return out;
      console.log("OpenRouter fallback fail:", j);
    } catch (e) {
      console.log("OpenRouter fallback error:", e);
    }
  }

  // 3) Фолбек без зовнішніх моделей
  return (
    "🧠 Поки що я працюю у легкому режимі без зовнішніх моделей.\n" +
    "Увімкни безкоштовні варіанти:\n" +
    "• Додай GEMINI_API_KEY або GOOGLE_API_KEY (AI Studio), або\n" +
    "• Підключи Cloudflare Workers AI (CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN)\n" +
    "та задай MODEL_ORDER. Приклад: gemini:gemini-1.5-flash-latest,cf:@cf/meta/llama-3-8b-instruct"
  );
}