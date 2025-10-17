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