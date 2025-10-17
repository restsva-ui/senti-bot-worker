// src/routes/visionApi.js
// Універсальний Vision endpoint: POST /api/vision?s=WEBHOOK_SECRET
// Працює з: Gemini (за замовч.), OpenRouter (фолбек), (опц.) Cloudflare AI
// Відповідь: { ok, provider, text, details? } або { ok:false, error, details }

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      ...extra,
    },
  });
}

export async function handleVisionApi(req, env, url) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type",
      },
    });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  try {
    // Безпека: secret у query ?s=
    const secret = url.searchParams.get("s") || "";
    if (!secret || (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET)) {
      return json({ ok: false, error: "forbidden" }, 403);
    }

    // Тіло запиту
    const body = await req.json().catch(() => ({}));
    const prompt = (body.prompt || "").toString().trim() || "Опиши зображення коротко.";
    const images = Array.isArray(body.images) ? body.images.filter(Boolean) : [];
    if (!images.length) {
      return json({ ok: false, error: "no_images" }, 400);
    }

    // Порядок провайдерів
    const orderStr =
      (env.VISION_ORDER ||
        env.MODEL_ORDER || // сумісність із налаштуваннями
        "gemini, openrouter").toLowerCase();

    const providers = orderStr
      .split(/[,; ]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const errors = [];

    for (const p of providers) {
      try {
        if (p === "gemini") {
          const r = await callGeminiVision(env, { prompt, images });
          return json({ ok: true, provider: "gemini", text: r.text, details: r.details || null });
        }
        if (p === "openrouter" || p === "or") {
          const r = await callOpenRouterVision(env, { prompt, images });
          return json({ ok: true, provider: "openrouter", text: r.text, details: r.details || null });
        }
        if (p === "cf" || p === "cloudflare") {
          const r = await callCloudflareVision(env, { prompt, images });
          return json({ ok: true, provider: "cloudflare", text: r.text, details: r.details || null });
        }
        errors.push(`${p}: unsupported`);
      } catch (e) {
        errors.push(`${p}: ${e?.message || String(e)}`);
      }
    }

    return json({ ok: false, error: "all_providers_failed", details: errors }, 502);
  } catch (e) {
    return json({ ok: false, error: e?.message || "vision_internal_error" }, 500);
  }
}
// ===== Helpers =====

function toGeminiContent(prompt, images) {
  // Підтримка URL і base64 ("data:image/...;base64,....")
  const parts = [{ text: prompt }];
  for (const img of images) {
    if (typeof img !== "string") continue;
    if (img.startsWith("data:image/")) {
      // dataURL
      const [meta, b64] = img.split(",", 2);
      const mime = (meta.match(/^data:(.*?);base64$/) || [])[1] || "image/jpeg";
      parts.push({
        inline_data: { mime_type: mime, data: b64 || "" },
      });
    } else {
      parts.push({
        image_url: { url: img },
      });
    }
  }
  return [{ role: "user", parts }];
}

async function callGeminiVision(env, { prompt, images }) {
  const key = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GEMINI_KEY;
  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
  if (!key) throw new Error("gemini: missing GEMINI_API_KEY");

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent?key=" +
    encodeURIComponent(key);

  const payload = {
    contents: toGeminiContent(prompt, images),
    safetySettings: [],
    generationConfig: { temperature: 0.6, topK: 40, topP: 0.9 },
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const d = await r.json().catch(() => ({}));

  if (!r.ok) {
    const msg = d?.error?.message || JSON.stringify(d).slice(0, 500);
    throw new Error(`gemini ${r.status}: ${msg}`);
  }

  const text =
    d?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
    d?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "";

  if (!text) throw new Error("gemini: empty_response");

  return { text, details: null };
}

async function callOpenRouterVision(env, { prompt, images }) {
  const key = env.OPENROUTER_API_KEY || env.FREE_API_KEY || env.GROQ_API_KEY; // останні — на випадок твого роутера
  const model =
    env.OPENROUTER_MODEL_VISION ||
    env.OPENROUTER_MODEL ||
    env.FREE_API_MODEL ||
    "meta-llama/llama-4.1-mini";

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
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.6,
    }),
  });

  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = d?.error?.message || d?.error || JSON.stringify(d).slice(0, 500);
    throw new Error(`openrouter ${r.status}: ${msg}`);
  }

  const text = d?.choices?.[0]?.message?.content || "";
  if (!text) throw new Error("openrouter: empty_response");

  return { text, details: null };
}

async function callCloudflareVision(env, { prompt, images }) {
  // Працює лише якщо у воркера є AI-binding (env.AI) та задано CF_VISION
  const model = env.CF_VISION; // напр.: "@cf/llama-3.2-11b-vision-instruct"
  if (!env.AI || !model) throw new Error("cloudflare: AI binding or CF_VISION not configured");

  const inputs = [
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
  ];

  const r = await env.AI.run(model, { messages: inputs }).catch((e) => {
    throw new Error("cloudflare: " + (e?.message || String(e)));
  });

  const text = r?.response || r?.result || "";
  if (!text) throw new Error("cloudflare: empty_response");

  return { text, details: null };
}

export default { handleVisionApi };