/**
 * Провайдери ШІ.
 * Порядок: Gemini → DeepSeek → Groq (fallback).
 * Vision — лише Gemini (найстабільніше з безкоштовних).
 *
 * Потрібні змінні:
 *  GEMINI_API_KEY (secret)
 *  DEEPSEEK_API_KEY (secret, опційно)
 *  GROQ_API_KEY (secret, опційно)
 *  AI_MODEL (plaintext, наприклад "gemini-1.5-flash")
 */

const GEMINI_TEXT_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=`;
const GEMINI_VISION_URL = GEMINI_TEXT_URL; // той самий ендпоінт

export async function aiText({ prompt }, env) {
  // 1) Gemini
  if (env.GEMINI_API_KEY) {
    const model = env.AI_MODEL || "gemini-1.5-flash";
    try {
      const r = await fetch(GEMINI_TEXT_URL(model) + env.GEMINI_API_KEY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      });
      const j = await r.json();
      const text =
        j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ??
        j?.candidates?.[0]?.content?.parts?.[0]?.text ??
        "";
      if (text) return text.trim();
    } catch (_e) {}
  }

  // 2) DeepSeek (сумісний з OpenAI chat.completions)
  if (env.DEEPSEEK_API_KEY) {
    try {
      const r = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: prompt },
          ],
          temperature: 0.7,
        }),
      });
      const j = await r.json();
      const text = j?.choices?.[0]?.message?.content ?? "";
      if (text) return text.trim();
    } catch (_e) {}
  }

  // 3) Groq (fallback, швидко/стабільно)
  if (env.GROQ_API_KEY) {
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: prompt },
          ],
          temperature: 0.7,
        }),
      });
      const j = await r.json();
      const text = j?.choices?.[0]?.message?.content ?? "";
      if (text) return text.trim();
    } catch (_e) {}
  }

  // Якщо все впало — повернемо дружню відповідь
  return "Вибач, зараз я перевантажений. Спробуй ще раз через хвилинку 🙏";
}

export async function aiVision({ prompt, imageUrl }, env) {
  // Vision тільки через Gemini
  if (!env.GEMINI_API_KEY) {
    return "Зараз аналіз зображень недоступний (не задано GEMINI_API_KEY).";
  }
  const model = env.AI_MODEL || "gemini-1.5-flash";

  // Google Gemini Vision приймає parts з text + inline_data/url_data.
  // Через URL простіше:
  try {
    const r = await fetch(GEMINI_VISION_URL(model) + env.GEMINI_API_KEY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt || "Опиши детально, що на фото. Додай висновки." },
              {
                file_data: {
                  mime_type: "image/jpeg",
                  file_uri: imageUrl,
                },
              },
            ],
          },
        ],
      }),
    });

    const j = await r.json();
    const text =
      j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ??
      j?.candidates?.[0]?.content?.parts?.[0]?.text ??
      "";

    return text?.trim() || "Не вдалося проаналізувати зображення 😕";
  } catch (_e) {
    return "Сталася помилка під час аналізу зображення.";
  }
}