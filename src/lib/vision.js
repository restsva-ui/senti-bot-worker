// src/lib/vision.js
// Універсальний раннер віжн-запиту з каскадом провайдерів.
// Повертає { ok, provider, model, text } або { ok:false, error, details[] }.

function toBase64(u8) {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

async function fetchAsBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch image ${url} -> ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const low = url.toLowerCase();
  let mime = "image/jpeg";
  if (low.endsWith(".png")) mime = "image/png";
  else if (low.endsWith(".gif")) mime = "image/gif";
  else if (low.endsWith(".webp")) mime = "image/webp";
  else if (low.endsWith(".svg")) mime = "image/svg+xml";
  return { mime, data: toBase64(buf) };
}

export async function runVision(env, { prompt = "Опиши зображення", images = [] } = {}) {
  if (!images || !images.length) {
    return { ok: false, error: "images array is empty" };
  }

  // підтримуємо обидві назви кліча
  const GEMINI_KEY = env.GEMINI_API_KEY || env.GOOGLE_GEMINI_API_KEY;
  const GEMINI_MODEL = env.GEMINI_MODEL || "gemini-2.5-flash";

  // нормалізуємо картинки: {type:"url"|"base64", value:"..."}
  const norm = [];
  for (const it of images) {
    if (typeof it !== "string") continue;
    if (it.startsWith("http")) {
      norm.push({ type: "url", value: it });
    } else if (/^data:image\/.+;base64,/.test(it)) {
      norm.push({ type: "base64", value: it.split(",")[1], mime: it.slice(5, it.indexOf(";")) }); // image/png
    } else {
      norm.push({ type: "url", value: it });
    }
  }

  const order = (env.VISION_ORDER || "gemini,openrouter")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  const errors = [];

  for (const provider of order) {
    try {
      // ── GEMINI ────────────────────────────────────────────────────────────
      if (provider === "gemini") {
        if (!GEMINI_KEY) { errors.push("gemini: key missing"); continue; }
        if (!(GEMINI_MODEL || "").includes("gemini")) { errors.push("gemini: model missing/invalid"); continue; }

        const parts = [{ text: prompt }];
        for (const img of norm) {
          if (img.type === "base64") {
            parts.push({ inline_data: { mime_type: img.mime || "image/jpeg", data: img.value } });
          } else {
            const { mime, data } = await fetchAsBase64(img.value);
            parts.push({ inline_data: { mime_type: mime, data } });
          }
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts }] }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`Gemini ${res.status} ${data?.error?.message || ""}`.trim());
        const text =
          (data?.candidates?.[0]?.content?.parts || [])
            .map(p => p?.text)
            .filter(Boolean)
            .join("\n")
            .trim();
        if (!text) throw new Error("Gemini empty");
        return { ok: true, provider: "gemini", model: GEMINI_MODEL, text };
      }

      // ── OPENROUTER ────────────────────────────────────────────────────────
      if (provider === "openrouter") {
        const key = env.OPENROUTER_API_KEY;
        const model = env.OPENROUTER_MODEL_VISION;
        if (!key) { errors.push("openrouter: key missing"); continue; }
        if (!model) { errors.push("openrouter: model missing"); continue; }

        const content = [{ type: "text", text: prompt }];
        for (const img of norm) {
          if (img.type === "url") {
            content.push({ type: "image_url", image_url: { url: img.value } });
          } else {
            const mime = img.mime || "image/jpeg";
            content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${img.value}` } });
          }
        }

        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Authorization": `Bearer ${key}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content }],
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`OpenRouter ${res.status} ${data?.error?.message || ""}`.trim());
        const text = (data?.choices?.[0]?.message?.content || "").trim();
        if (!text) throw new Error("OpenRouter empty");
        return { ok: true, provider: "openrouter", model, text };
      }

      errors.push(`${provider}: unsupported`);
    } catch (e) {
      errors.push(`${provider}: ${String(e.message || e)}`);
      // переходимо до наступного провайдера
    }
  }

  return { ok: false, error: "all providers failed", details: errors };
}