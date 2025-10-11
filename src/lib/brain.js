// src/lib/brain.js
// "Мозок" Senti. Вміє:
// 1) Якщо задано MODEL_ORDER — використовує роутер (Gemini / CF / OpenRouter у будь-якому порядку).
// 2) Якщо MODEL_ORDER немає — пробує Gemini (GEMINI_API_KEY або GOOGLE_API_KEY),
//    потім OpenRouter. Далі м’який фолбек.

import { askAnyModel } from "./modelRouter.js";

const GEMINI_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

/* локальний виклик Gemini напряму (коли MODEL_ORDER не заданий) */
async function tryGeminiDirect(env, text, systemHint, opts = {}) {
  const key = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!key) return null;

  const modelId = "gemini-1.5-flash-latest";
  const url = `${GEMINI_BASE}/${encodeURIComponent(
    modelId
  )}:generateContent?key=${key}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: systemHint ? `${systemHint}\n\n${text}` : text }],
      },
    ],
    generationConfig: {
      temperature: opts.temperature ?? 0.6,
      maxOutputTokens: opts.max_tokens ?? 1024,
    },
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    // тихо даємо шанс іншим провайдерам
    return null;
  }
  return j?.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

async function tryOpenRouterDirect(env, text, systemHint, opts = {}) {
  if (!env.OPENROUTER_API_KEY) return null;

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL || "google/gemini-flash-1.5",
      messages: [
        ...(systemHint ? [{ role: "system", content: systemHint }] : []),
        { role: "user", content: text },
      ],
      temperature: opts.temperature ?? 0.6,
      max_tokens: opts.max_tokens ?? 1024,
    }),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) return null;
  return j?.choices?.[0]?.message?.content || null;
}

export async function think(env, userText, systemHint = "") {
  const text = String(userText || "").trim();
  if (!text) return "🤖 Дай мені текст або запитання — і я відповім.";

  // 0) Якщо вказано порядок провайдерів — використовуємо роутер
  if (env.MODEL_ORDER) {
    try {
      const merged =
        systemHint ? `${systemHint}\n\nКористувач: ${text}` : text;
      return await askAnyModel(env, merged, { temperature: 0.6, max_tokens: 1024 });
    } catch (e) {
      // впадемо у резервні стратегії
      console.log("Router failed:", e?.message || e);
    }
  }

  // 1) Gemini напряму (працює з GEMINI_API_KEY або GOOGLE_API_KEY)
  try {
    const g = await tryGeminiDirect(env, text, systemHint, {
      temperature: 0.6,
      max_tokens: 1024,
    });
    if (g) return g;
  } catch (e) {
    console.log("Gemini direct error:", e?.message || e);
  }

  // 2) OpenRouter як резерв
  try {
    const o = await tryOpenRouterDirect(env, text, systemHint, {
      temperature: 0.6,
      max_tokens: 1024,
    });
    if (o) return o;
  } catch (e) {
    console.log("OpenRouter direct error:", e?.message || e);
  }

  // 3) М’який фолбек
  const tips = [];
  if (!env.GEMINI_API_KEY && !env.GOOGLE_API_KEY)
    tips.push("• Додай GEMINI_API_KEY або GOOGLE_API_KEY (AI Studio)");
  if (!env.OPENROUTER_API_KEY)
    tips.push("• Або OPENROUTER_API_KEY (+ OPENROUTER_MODEL, за бажання)");
  if (!env.CF_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN)
    tips.push("• Або увімкни Cloudflare Workers AI (CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN) і задай MODEL_ORDER");

  return (
    "🧠 Поки що я працюю у легкому режимі без зовнішніх моделей.\n" +
    (tips.length ? "Безкоштовно увімкнути:\n" + tips.join("\n") + "\n" : "") +
    "За бажання, визнач порядок у MODEL_ORDER (наприклад: gemini:gemini-1.5-flash-latest,cf:@cf/meta/llama-3-8b-instruct,openrouter:deepseek/deepseek-chat)."
  );
}