// src/lib/brain.js
// Використовуємо askAnyModel. Якщо всі моделі впали — повертаємо зрозумілу діагностику.

import { askAnyModel } from "./modelRouter.js";

export async function think(env, userText, systemHint = "") {
  const text = String(userText || "").trim();
  if (!text) return "🤖 Дай мені текст або запитання — і я відповім.";

  const prompt = systemHint ? `${systemHint}\n\nКористувач: ${text}` : text;

  try {
    const out = await askAnyModel(env, prompt, { temperature: 0.4, max_tokens: 1024 });
    if (out && typeof out === "string") return out;
  } catch (e) {
    const status = e?.status || 0;
    const msg = e?.message || "model error";
    const where =
      msg.startsWith("cf ") ? "Cloudflare Workers AI" :
      msg.startsWith("gemini ") ? "Gemini" :
      msg.startsWith("openrouter ") ? "OpenRouter" :
      "Модель";
    const note =
      status === 402 ? "Недостатньо коштів/доступу." :
      status === 429 ? "Перевищено ліміт (rate limit)." :
      status ? `HTTP ${status}. ${msg}` : msg;

    return (
      "🧠 Зараз не вдалось відповісти через зовнішню модель.\n" +
      `Причина: ${where} — ${note}\n\n` +
      "Що зробити безкоштовно:\n" +
      "• Увімкни Gemini (GOOGLE_API_KEY) або Cloudflare Workers AI (CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN).\n" +
      "• Порядок провайдерів керується MODEL_ORDER (наприклад: gemini:gemini-1.5-flash-latest,cf:@cf/meta/llama-3.1-8b-instruct,openrouter:deepseek/deepseek-chat)."
    );
  }

  return (
    "🧠 Моделі тимчасово недоступні. Рекомендація: активуй Gemini або CF Workers AI.\n" +
    "Перевір змінні середовища та MODEL_ORDER."
  );
}