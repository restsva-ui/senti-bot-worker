// src/lib/brain.js
// "Мозок" Senti через modelRouter: CF Workers AI (безкоштовно) → OpenRouter (резерв)
// Якщо усі моделі впали — повертаємо зрозумілий діагностичний фолбек.

import { askAnyModel } from "./modelRouter.js";

export async function think(env, userText, systemHint = "") {
  const text = String(userText || "").trim();
  if (!text) return "🤖 Дай мені текст або запитання — і я відповім.";

  // системний контекст + юзерський запит
  const prompt = systemHint ? `${systemHint}\n\nКористувач: ${text}` : text;

  try {
    const out = await askAnyModel(env, prompt, { temperature: 0.4, max_tokens: 1024 });
    if (out && typeof out === "string") return out;
  } catch (e) {
    // Прокинемося у фолбек нижче з нормальною діагностикою
    const status = e?.status || 0;
    const where =
      (e?.message || "").startsWith("cf ") ? "Cloudflare Workers AI" :
      (e?.message || "").startsWith("openrouter ") ? "OpenRouter" :
      "модель";
    const note =
      status === 402 ? "Недостатньо коштів/доступу до моделі." :
      status === 429 ? "Перевищено ліміт запитів (rate limit)." :
      status ? `HTTP ${status}.` : "Немає доступних ключів/конфігурації.";
    return (
      "🧠 Зараз не вдалось відповісти через зовнішню модель.\n" +
      `Причина: ${where} — ${note}\n\n` +
      "Що робити безкоштовно: переконайся, що увімкнено CF Workers AI (CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN).\n" +
      "Додатково (як резерв): OPENROUTER_API_KEY та безкоштовна/доступна модель у MODEL_ORDER."
    );
  }

  // Фолбек, якщо ніщо не повернуло текст.
  return (
    "🧠 Моделі тимчасово недоступні. Безкоштовний варіант — Cloudflare Workers AI.\n" +
    "Перевір змінні: CF_ACCOUNT_ID та CLOUDFLARE_API_TOKEN. " +
    "Резерв: OPENROUTER_API_KEY + MODEL_ORDER."
  );
}