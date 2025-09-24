// src/ai/providers.js
// Виклики моделей через Cloudflare AI Gateway (рекомендується) або напряму.
// Порядок: gemini -> deepseek -> groq (fallback).
// Для простоти: однаковий контракт для text і vision.

function cfGateway(env) {
  const base = env.CF_AI_GATEWAY_BASE; // напр.: https://gateway.ai.cloudflare.com/v1/<account>/<gateway>
  if (!base) throw new Error("CF_AI_GATEWAY_BASE is not set");
  return base.replace(/\/+$/, "");
}

export function chooseTextProvider(env) {
  // Якщо заданий AI_PROVIDERS — читаємо звідти, інакше дефолтний порядок
  const cfg = (env.AI_PROVIDERS || "").trim();
  if (cfg) {
    // очікуємо "text:gemini,deepseek;vision:gemini"
    const part = cfg.split(";").find(x => x.startsWith("text:"));
    if (part) return part.replace("text:", "").split(",").map(x => x.trim()).filter(Boolean);
  }
  return ["gemini", "deepseek", "groq"];
}

export async function callTextModel({ provider, prompt, env }) {
  switch (provider) {
    case "gemini":
      return callGeminiText(prompt, env);
    case "deepseek":
      return callDeepseekText(prompt, env);
    case "groq":
      return callGroqText(prompt, env);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

export async function callVisionModel({ imageUrl, prompt, env }) {
  // Для безкоштовного варіанту — Gemini 1.5 Flash через AI Gateway
  return callGeminiVision({ imageUrl, prompt }, env);
}

/* ---------- Gemini via CF AI Gateway ---------- */

async function callGeminiText(prompt, env) {
  const base = cfGateway(env);
  const model = env.AI_MODEL || "gemini-1.5-flash";
  const url = `${base}/workers-ai/google/gemini/${model}:generateContent`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${env.GEMINI_API_KEY || ""}`,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!res.ok) throw new Error(`Gemini text ${res.status}`);
  const data = await res.json();

  // Витягуємо перший блок тексту
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return text.trim() || "…";
}

async function callGeminiVision({ imageUrl, prompt }, env) {
  const base = cfGateway(env);
  const model = env.CF_Vision || "gemini-1.5-flash"; // можна окремо задати, якщо хочеш
  const url = `${base}/workers-ai/google/gemini/${model}:generateContent`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${env.GEMINI_API_KEY || ""}`,
    },
    body: JSON.stringify({
      contents: [
        { parts: [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: await fetchAsBase64(imageUrl) } }] },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Gemini vision ${res.status}`);
  const data = await res.json();

  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  // Проста евристика: робимо summary і bullets
  return {
    summary: raw.split("\n")[0].replace(/^[^a-zA-Zа-яА-Я0-9]+/, "").trim() || "щось на знімку",
    bullets: raw
      .split("\n")
      .filter((l) => l.trim().startsWith("*") || l.trim().startsWith("-"))
      .map((l) => l.replace(/^[-*]\s?/, "").trim())
      .slice(0, 5),
  };
}

async function fetchAsBase64(url) {
  const r = await fetch(url);
  const buf = await r.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/* ---------- DeepSeek via OpenRouter (безкоштовні квоти/акції трапляються) ---------- */

async function callDeepseekText(prompt, env) {
  if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");
  const model = env.OPENROUTER_MODEL || "deepseek/deepseek-chat";
  const url = "https://openrouter.ai/api/v1/chat/completions";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "Відповідай коротко та по суті." },
        { role: "user", content: prompt },
      ],
      temperature: 0.5,
    }),
  });

  if (!res.ok) throw new Error(`DeepSeek ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  return text.trim();
}

/* ---------- Groq (fallback) ---------- */

async function callGroqText(prompt, env) {
  if (!env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set");
  const model = env.GROQ_MODEL || "llama-3.1-8b-instant";
  const url = "https://api.groq.com/openai/v1/chat/completions";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "Відповідай коротко та по суті." },
        { role: "user", content: prompt },
      ],
      temperature: 0.5,
    }),
  });

  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  return text.trim();
}