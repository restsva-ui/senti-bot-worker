// src/lib/brain.js
// "Мозок" Senti: спочатку використовує маршрутизатор (MODEL_ORDER),
// якщо не задано — підхоплює ключі напряму: GEMINI_API_KEY/GOOGLE_API_KEY або OPENROUTER_API_KEY.

import { askAnyModel } from "./modelRouter.js";

const TRIM = (s) => (s || "").toString().trim();

export async function think(env, userText, systemHint = "") {
  const text = TRIM(userText);
  if (!text) return "🤖 Дай мені текст або запитання — і я відповім.";

  // 1) Якщо задано MODEL_ORDER — користуємось роутером з системною підказкою
  if (TRIM(env.MODEL_ORDER)) {
    try {
      const out = await askAnyModel(env, text, { system: systemHint, temperature: 0.6, max_tokens: 1024 });
      if (TRIM(out)) return out;
    } catch (e) {
      // провалимося на локальні фолбеки нижче
    }
  }

  // 2) Прямий виклик Gemini (якщо є GEMINI_API_KEY або GOOGLE_API_KEY)
  const GEMINI_KEY = TRIM(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
  if (GEMINI_KEY) {
    try {
      const model = TRIM(env.GEMINI_MODEL) || "gemini-1.5-flash-latest";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;
      const body = {
        contents: [
          {
            role: "user",
            parts: [{ text: systemHint ? `${systemHint}\n\n${text}` : text }],
          },
        ],
        generationConfig: { temperature: 0.6, maxOutputTokens: 1024 },
      };
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      const out = (j?.candidates?.[0]?.content?.parts || [])
        .map((p) => p?.text)
        .filter(Boolean)
        .join("\n");
      if (r.ok && TRIM(out)) return out;
    } catch (e) {}
  }

  // 3) Прямий виклик OpenRouter (якщо є ключ)
  const OR_KEY = TRIM(env.OPENROUTER_API_KEY);
  if (OR_KEY) {
    try {
      const model = TRIM(env.OPENROUTER_MODEL) || "openrouter/auto";
      const messages = [];
      if (TRIM(systemHint)) messages.push({ role: "system", content: TRIM(systemHint) });
      messages.push({ role: "user", content: text });

      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OR_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.6,
          max_tokens: 1024,
        }),
      });
      const j = await r.json().catch(() => ({}));
      const out = j?.choices?.[0]?.message?.content || "";
      if (r.ok && TRIM(out)) return out;
    } catch (e) {}
  }

  // 4) Фолбек — ключів немає або все впало.
  return (
    "🧠 Поки що я працюю у легкому режимі без зовнішніх моделей.\n" +
    "Додай один із ключів у воркер:\n" +
    "• GEMINI_API_KEY або GOOGLE_API_KEY\n" +
    "• або OPENROUTER_API_KEY (+ OPENROUTER_MODEL, за бажання)\n" +
    "— і відповіді стануть «розумними»."
  );
}