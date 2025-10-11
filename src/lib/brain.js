// src/lib/brain.js
// Спершу пробуємо MODEL_ORDER через роутер, далі прямі виклики, і якщо все впало — пояснюємо чому.

import { askAnyModel } from "./modelRouter.js";

const GEMINI_FALLBACK_MODEL = "gemini-1.5-flash-latest";

export async function think(env, userText, systemHint = "", opts = {}) {
  const text = String(userText || "").trim();
  if (!text) return "🤖 Дай мені текст або запитання — і я відповім.";
  const prompt = systemHint ? `${systemHint}\n\nКористувач: ${text}` : text;

  // 1) MODEL_ORDER
  if (env.MODEL_ORDER) {
    try {
      return await askAnyModel(env, prompt, { temperature: 0.4, max_tokens: 1024, ...opts });
    } catch (e) {
      // покажемо зрозуміле пояснення
      const why = `${e?.message || "router error"}${e?.payload?.errors ? " — " + JSON.stringify(e.payload.errors) : ""}`;
      return "🧠 Зараз не вдалось відповісти через зовнішню модель.\nПричина: " + why +
        "\n\nЩо зробити безкоштовно:\n• Увімкни Gemini (GEMINI_API_KEY або GOOGLE_API_KEY)\n" +
        "• або Cloudflare Workers AI (CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN).\n" +
        "• Порядок провайдерів керується MODEL_ORDER (напр.: gemini:gemini-1.5-flash-latest,cf:@cf/meta/llama-3-8b-instruct).";
    }
  }

  // 2) Прямий Gemini
  const gKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (gKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_FALLBACK_MODEL)}:generateContent?key=${gKey}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
        }),
      });
      const j = await r.json();
      const out = j?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (r.ok && out) return out;
      return `🧠 Gemini відповів помилкою (${r.status}). ${j?.error?.message || ""}`;
    } catch (e) {
      return `🧠 Gemini недоступний: ${String(e)}`;
    }
  }

  // 3) Прямий OpenRouter
  if (env.OPENROUTER_API_KEY) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
        body: JSON.stringify({
          model: env.OPENROUTER_MODEL || "deepseek/deepseek-chat",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.5,
        }),
      });
      const j = await r.json();
      const out = j?.choices?.[0]?.message?.content;
      if (r.ok && out) return out;
      return `🧠 OpenRouter помилка (${r.status}).`;
    } catch (e) {
      return `🧠 OpenRouter недоступний: ${String(e)}`;
    }
  }

  // 4) Легкий режим
  return (
    "🧠 Поки що я працюю у легкому режимі без зовнішніх моделей.\n" +
    "Безкоштовно увімкнути:\n" +
    "• Додай GEMINI_API_KEY або GOOGLE_API_KEY (AI Studio), або\n" +
    "• Підключи Cloudflare Workers AI (CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN)\n" +
    "  і задай MODEL_ORDER, напр.: gemini:gemini-1.5-flash-latest,cf:@cf/meta/llama-3-8b-instruct"
  );
}