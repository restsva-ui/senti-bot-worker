// src/lib/brain.js
// Мінімальний "мозок" Senti з підтримкою Gemini (GOOGLE_API_KEY) та OpenRouter (OPENROUTER_API_KEY).
// Працює з будь-яким одним ключем; якщо ключів немає — дає м’який фолбек.

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent";

export async function think(env, userText, systemHint = "") {
  const text = String(userText || "").trim();
  if (!text) return "🤖 Дай мені текст або запитання — і я відповім.";

  // 1) Спроба через Gemini (безкоштовний/пільговий тариф часто є; залежить від акаунта)
  if (env.GOOGLE_API_KEY) {
    try {
      const body = {
        contents: [
          {
            role: "user",
            parts: [{ text: systemHint ? `${systemHint}\n\n${text}` : text }],
          },
        ],
      };
      const r = await fetch(`${GEMINI_URL}?key=${env.GOOGLE_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      const out =
        j?.candidates?.[0]?.content?.parts?.[0]?.text ||
        j?.candidates?.[0]?.content?.parts?.[0]?.text ||
        "";
      if (r.ok && out) return out;
      // якщо помилка — падаємо у наступний провайдер
      console.log("Gemini fail:", j);
    } catch (e) {
      console.log("Gemini error:", e);
    }
  }

  // 2) Спроба через OpenRouter (якщо маєш OPENROUTER_API_KEY; можна вибрати безкоштовну модель, якщо доступна у акаунті)
  if (env.OPENROUTER_API_KEY) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: env.OPENROUTER_MODEL || "google/gemini-flash-1.5", // або іншу легку модель свого акаунта
          messages: [
            ...(systemHint ? [{ role: "system", content: systemHint }] : []),
            { role: "user", content: text },
          ],
          temperature: 0.7,
        }),
      });
      const j = await r.json();
      const out = j?.choices?.[0]?.message?.content;
      if (r.ok && out) return out;
      console.log("OpenRouter fail:", j);
    } catch (e) {
      console.log("OpenRouter error:", e);
    }
  }

  // 3) Фолбек, якщо ключів немає або все впало.
  return (
    "🧠 Поки що я працюю у легкому режимі без зовнішніх моделей.\n" +
    "Додай GOOGLE_API_KEY або OPENROUTER_API_KEY у воркер — і відповіді стануть «розумними»."
  );
}