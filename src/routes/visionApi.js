// src/routes/visionApi.js
// Каскадне розпізнавання зображення: gemini → openrouter (→ cf опційно)

import { json } from "../utils/http.js"; // якщо в тебе інший хелпер – заміни імпорт

function toBase64(ab) {
  let bin = "";
  const bytes = new Uint8Array(ab);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function fetchImageAsB64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`image fetch ${r.status}`);
  const mime = r.headers.get("content-type") || "image/jpeg";
  const buf = await r.arrayBuffer();
  return { mime, b64: toBase64(buf) };
}

// ── Providers ────────────────────────────────────────────────────────────────
async function callGeminiVision({ apiKey, model, prompt, mime, b64 }) {
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");
  const m = model || "gemini-2.5-flash"; // text+image
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mime, data: b64 } }
        ]
      }
    ]
  };

  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`gemini ${r.status}: ${d?.error?.message || "unknown"}`);

  const parts = d?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text || "").join("").trim();
  if (!text) throw new Error("gemini empty");
  return text;
}

async function callOpenRouterVision({ apiKey, model, prompt, imageUrl }) {
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing");
  if (!model) throw new Error("OPENROUTER_MODEL_VISION missing");
  const endpoint = "https://openrouter.ai/api/v1/chat/completions";

  const body = {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: imageUrl }
        ]
      }
    ]
  };

  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://senti-bot-worker", // опціонально
      "X-Title": "Senti Vision"
    },
    body: JSON.stringify(body)
  });

  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`openrouter ${r.status}: ${d?.error?.message || "unknown"}`);

  const text = d?.choices?.[0]?.message?.content || "";
  if (!text.trim()) throw new Error("openrouter empty");
  return text.trim();
}

// (Опціонально) Cloudflare Workers AI — залишив заглушку,
// бо формати візуалок часто відрізняються між моделями.
// Якщо захочеш — додамо точну модель і payload під неї.
/*
async function callCloudflareVision({ accountId, token, model, prompt, imageUrl }) {
  if (!accountId || !token || !model) throw new Error("CF config missing");
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encodeURIComponent(model)}`;
  const body = {
    // найновіший уніфікований формат messages:
    messages: [{
      role: "user",
      content: [
        { type: "input_text", text: prompt },
        { type: "input_image", image_url: imageUrl }
      ]
    }]
  };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`cf ${r.status}: ${JSON.stringify(d).slice(0,120)}`);
  const txt = d?.result?.response || d?.result?.output_text || d?.result?.text || "";
  if (!txt.trim()) throw new Error("cf empty");
  return txt.trim();
}
*/

// ── HTTP handler ─────────────────────────────────────────────────────────────
export async function handleVisionApi(req, env, url) {
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let body = {};
  try { body = await req.json(); } catch {}
  const prompt = (body.prompt || "Опиши зображення").toString();
  const images = Array.isArray(body.images) ? body.images : [];
  const imageUrl = images[0];
  if (!imageUrl) return json({ ok: false, error: "images[0] required" }, 400);

  // завантажуємо картинку 1 раз
  let img;
  try { img = await fetchImageAsB64(imageUrl); }
  catch (e) { return json({ ok: false, error: `image: ${String(e.message || e)}` }, 502); }

  // порядок провайдерів
  const order = (env.VISION_ORDER || "gemini,openrouter")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  const errors = [];

  for (const provider of order) {
    try {
      if (provider === "gemini") {
        const text = await callGeminiVision({
          apiKey: env.GEMINI_API_KEY || env.GOOGLE_GEMINI_API_KEY,
          model: env.GEMINI_MODEL || env.GEMINI_VISION_MODEL || "gemini-2.5-flash",
          prompt,
          mime: img.mime,
          b64: img.b64
        });
        return json({ ok: true, provider: "gemini", result: text });
      }
      if (provider === "openrouter") {
        const text = await callOpenRouterVision({
          apiKey: env.OPENROUTER_API_KEY,
          model: env.OPENROUTER_MODEL_VISION,
          prompt,
          imageUrl
        });
        return json({ ok: true, provider: "openrouter", result: text });
      }
      // if (provider === "cf") {
      //   const text = await callCloudflareVision({
      //     accountId: env.CF_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID,
      //     token: env.CLOUDFLARE_API_TOKEN,
      //     model: env.CF_VISION, // приклад: "@cf/llama-3.2-11b-vision-instruct"
      //     prompt, imageUrl
      //   });
      //   return json({ ok: true, provider: "cf", result: text });
      // }

      errors.push(`${provider}: unsupported`);
    } catch (e) {
      errors.push(`${provider}: ${String(e.message || e)}`);
      // ідемо далі по каскаду
    }
  }

  return json({ ok: false, error: "all providers failed", details: errors }, 502);
}