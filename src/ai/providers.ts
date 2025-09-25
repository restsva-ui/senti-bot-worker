// src/ai/providers.js
// Лаконічні провайдери для тексту та зображень на Cloudflare Workers AI.
// Нічого зайвого: повертаємо простий рядок, щоб не ламати існуючі хендлери.

const TEXT_MODEL = "@cf/meta/llama-3.1-8b-instruct";          // швидка й дешева
const VISION_MODEL = "@cf/llama-3.2-11b-vision-instruct";      // для зображень

/**
 * Генерує коротку відповідь українською.
 * @param {string} userText
 * @param {any} env - Worker env (має містити binding AI)
 * @returns {Promise<string>}
 */
export async function aiText(userText, env) {
  const prompt = (userText ?? "").trim();
  if (!prompt) return "(порожній запит)";

  try {
    // Формат chat-messages сумісний з Workers AI
    const res = await env.AI.run(TEXT_MODEL, {
      messages: [
        {
          role: "system",
          content:
            "Ти лаконічний асистент українською. Відповідай коротко та по суті (1–3 речення).",
        },
        { role: "user", content: prompt },
      ],
    });

    // У CF AI буває response або output_text
    const out = (res && (res.response || res.output_text || "")) || "";
    const text = String(out).trim();
    return text || "Не вдалося згенерувати відповідь.";
  } catch (err) {
    console.error("AI text error:", err);
    return "Не вийшло звернутися до моделі. Спробуй інакше сформулювати запит.";
  }
}

/**
 * Стислий опис зображення (якщо переданий imageUrl).
 * @param {{ prompt?: string, imageUrl?: string }} args
 * @param {any} env
 * @returns {Promise<string>}
 */
export async function aiVision({ prompt, imageUrl } = {}, env) {
  if (!imageUrl) {
    // Не ламаємо існуючі тексти-нотифікації у твоєму хендлері
    return "Бачу зображення, але не отримав його URL для аналізу.";
  }

  const userPrompt =
    (prompt && String(prompt).trim()) ||
    "Опиши зображення стисло українською й зроби 1–2 висновки.";

  // Два способи виклику: сучасний messages та fallback через image:{url}
  // Щоб не впасти, пробуємо послідовно.
  try {
    // Варіант 1: через messages із image_url
    const res1 = await env.AI.run(VISION_MODEL, {
      messages: [
        { role: "system", content: "Відповідай коротко українською." },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: imageUrl },
            { type: "text", text: userPrompt },
          ],
        },
      ],
    });
    const out1 =
      (res1 && (res1.response || res1.output_text || res1.description)) || "";
    const txt1 = String(out1).trim();
    if (txt1) return txt1;
  } catch (e1) {
    console.warn("AI vision (messages) failed, try fallback:", e1);
  }

  try {
    // Варіант 2: старий інтерфейс LLaVA-подібних моделей
    const res2 = await env.AI.run(VISION_MODEL, {
      prompt: userPrompt,
      image: [{ url: imageUrl }],
    });
    const out2 =
      (res2 && (res2.response || res2.output_text || res2.description)) || "";
    const txt2 = String(out2).trim();
    if (txt2) return txt2;
  } catch (e2) {
    console.error("AI vision (fallback) error:", e2);
  }

  return "Не зміг проаналізувати зображення.";
}
