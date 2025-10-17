// src/lib/vision.js
// Допоміжні виклики для Vision (можеш використовувати в інших місцях бота)

export async function visionByProviders(env, { prompt, images }) {
  const orderStr =
    (env.VISION_ORDER || env.MODEL_ORDER || "gemini, openrouter").toLowerCase();
  const providers = orderStr.split(/[,; ]+/).map((s) => s.trim()).filter(Boolean);
  const details = [];

  for (const p of providers) {
    try {
      if (p === "gemini") return await geminiVision(env, { prompt, images });
      if (p === "openrouter" || p === "or") return await openrouterVision(env, { prompt, images });
      if (p === "cf" || p === "cloudflare") return await cloudflareVision(env, { prompt, images });
      details.push(`${p}: unsupported`);
    } catch (e) {
      details.push(`${p}: ${e?.message || String(e)}`);
    }
  }
  const err = new Error("all_providers_failed");
  err.details = details;
  throw err;
}

async function geminiVision(env, { prompt, images }) {
  const key = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GEMINI_KEY;
  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
  if (!key) throw new Error("gemini: missing GEMINI_API_KEY");

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent?key=" +
    encodeURIComponent(key);

  const contents = [
    {
      role: "user",
      parts: [
        { text: prompt },
        ...images.map((u) =>
          typeof u === "string" && u.startsWith("data:image/")
            ? {
                inline_data: {
                  mime_type: (u.match(/^data:(.*?);base64,/) || [])[1] || "image/jpeg",
                  data: u.split(",", 2)[1] || "",
                },
              }
            : { image_url: { url: u } }
        ),
      ],
    },
  ];

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents, safetySettings: [], generationConfig: { temperature: 0.6 } }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`gemini ${r.status}: ${d?.error?.message || JSON.stringify(d).slice(0, 400)}`);
  }

  const text =
    d?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
    d?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "";
  if (!text) throw new Error("gemini: empty_response");

  return { provider: "gemini", text };
}

async function openrouterVision(env, { prompt, images }) {
  const key = env.OPENROUTER_API_KEY || env.FREE_API_KEY;
  const model =
    env.OPENROUTER_MODEL_VISION || env.OPENROUTER_MODEL || env.FREE_API_MODEL || "meta-llama/llama-4.1-mini";
  if (!key) throw new Error("openrouter: missing OPENROUTER_API_KEY");

  const endpoint =
    env.FREE_API_BASE_URL ||
    "https://openrouter.ai/api" + (env.FREE_API_PATH || "/v1/chat/completions");

  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        ...images.map((u) =>
          typeof u === "string" && u.startsWith("data:image/")
            ? { type: "input_image", image: u }
            : { type: "image_url", image_url: { url: u } }
        ),
      ],
    },
  ];

  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://senti-bot-worker.restsva.workers.dev",
      "X-Title": "Senti Vision",
    },
    body: JSON.stringify({ model, messages, temperature: 0.6 }),
  });

  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`openrouter ${r.status}: ${d?.error?.message || d?.error || JSON.stringify(d).slice(0, 400)}`);
  }

  const text = d?.choices?.[0]?.message?.content || "";
  if (!text) throw new Error("openrouter: empty_response");
  return { provider: "openrouter", text };
}

async function cloudflareVision(env, { prompt, images }) {
  const model = env.CF_VISION;
  if (!env.AI || !model) throw new Error("cloudflare: AI binding or CF_VISION not configured");

  const r = await env.AI.run(model, {
    messages: [
      { role: "system", content: "You are a concise visual assistant." },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...images.map((u) =>
            typeof u === "string" && u.startsWith("data:image/")
              ? { type: "image", image: u }
              : { type: "image_url", url: u }
          ),
        ],
      },
    ],
  });

  const text = r?.response || r?.result || "";
  if (!text) throw new Error("cloudflare: empty_response");
  return { provider: "cloudflare", text };
}