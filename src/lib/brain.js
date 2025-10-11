// src/lib/brain.js
// "Мозок" Senti: спочатку пробуємо MODEL_ORDER через роутер (Gemini/CF/OpenRouter),
// далі — прямі фолбеки (Gemini або OpenRouter), і лише тоді — легкий режим.

import { askAnyModel } from "./modelRouter.js";

const GEMINI_FALLBACK_MODEL = "gemini-1.5-flash-latest";

export async function think(env, userText, systemHint = "") {
  const text = String(userText || "").trim();
  if (!text) return "🤖 Дай мені текст або запитання — і я відповім.";

  const prompt = systemHint ? `${systemHint}\n\nКористувач: ${text}` : text;

  // ── 1) Якщо задано MODEL_ORDER — пробуємо через роутер
  if (env.MODEL_ORDER) {
    try {
      return await askAnyModel(env, prompt, { temperature: 0.4, max_tokens: 1024 });
    } catch (e) {
      // переносимо причину у фолбек нижче, але не зупиняємось
      console.log("Router fail:", e?.status, e?.message);
    }
  }

  // ── 2) Прямий Gemini (якщо є хоча б один ключ)
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
      console.log("Gemini direct fail:", j);
    } catch (e) {
      console.log("Gemini direct error:", e);
    }
  }

  // ── 3) Прямий OpenRouter як запасний варіант
  if (env.OPENROUTER_API_KEY) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: env.OPENROUTER_MODEL || "deepseek/deepseek-chat",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.5,
        }),
      });
      const j = await r.json();
      const out = j?.choices?.[0]?.message?.content;
      if (r.ok && out) return out;
      console.log("OpenRouter direct fail:", j);
    } catch (e) {
      console.log("OpenRouter direct error:", e);
    }
  }

  // ── 4) Легкий режим
  return (
    "🧠 Поки що я працюю у легкому режимі без зовнішніх моделей.\n" +
    "Безкоштовно увімкнути:\n" +
    "• Додай GEMINI_API_KEY або GOOGLE_API_KEY (AI Studio), або\n" +
    "• Підключи Cloudflare Workers AI (CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN) і задай MODEL_ORDER, наприклад:\n" +
    "  gemini:gemini-1.5-flash-latest,cf:@cf/meta/llama-3-8b-instruct"
  );
}