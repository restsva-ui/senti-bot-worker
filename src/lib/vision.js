// src/lib/vision.js
// Універсальний раннер віжн-запиту через Gemini або OpenRouter (Vision).
// Повертає { ok, provider, model, text }.

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
  // спробуємо вгадати mime за розширенням
  const low = url.toLowerCase();
  let mime = "image/jpeg";
  if (low.endsWith(".png")) mime = "image/png";
  else if (low.endsWith(".gif")) mime = "image/gif";
  else if (low.endsWith(".webp")) mime = "image/webp";
  else if (low.endsWith(".svg")) mime = "image/svg+xml";
  return { mime, data: toBase64(buf) };
}

function pickVisionProvider(env) {
  // 1) Gemini (перевага, якщо є ключ)
  if (env.GEMINI_API_KEY && (env.GEMINI_MODEL || "").includes("gemini")) {
    return { provider: "gemini", model: env.GEMINI_MODEL || "gemini-2.5-flash" };
  }
  // 2) OpenRouter (будь-яка віжн-модель)
  if (env.OPENROUTER_API_KEY && env.OPENROUTER_MODEL_VISION) {
    return { provider: "openrouter", model: env.OPENROUTER_MODEL_VISION };
  }
  throw new Error("No vision provider configured");
}

export async function runVision(env, { prompt = "Опиши зображення", images = [] } = {}) {
  if (!images || !images.length) {
    return { ok: false, error: "images array is empty" };
  }

  const spec = pickVisionProvider(env);

  // нормалізуємо картинки: {type:"url"|"base64", value:"..."}
  const norm = [];
  for (const it of images) {
    if (typeof it !== "string") continue;
    if (it.startsWith("http")) {
      norm.push({ type: "url", value: it });
    } else if (/^data:image\/.+;base64,/.test(it)) {
      norm.push({ type: "base64", value: it.split(",")[1], mime: it.slice(5, it.indexOf(";")) }); // image/png
    } else {
      // вважаємо, що це посилання — підтягнемо байти і зробимо base64 (для Gemini)
      norm.push({ type: "url", value: it });
    }
  }

  try {
    if (spec.provider === "gemini") {
      // Gemini API чекає inline_data (base64). Якщо дали URL — підкачаємо.
      const parts = [{ text: prompt }];
      for (const img of norm) {
        if (img.type === "base64") {
          parts.push({ inline_data: { mime_type: img.mime || "image/jpeg", data: img.value } });
        } else {
          const { mime, data } = await fetchAsBase64(img.value);
          parts.push({ inline_data: { mime_type: mime, data } });
        }
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(spec.model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts }] }),
      });
      const data = await res.json().catch(() => ({}));
      const text =
        data?.candidates?.[0]?.content?.parts?.map(p => p?.text).filter(Boolean).join("\n").trim() ||
        data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        "";
      if (!res.ok) throw new Error(`Gemini ${res.status} ${JSON.stringify(data)}`);
      return { ok: true, provider: spec.provider, model: spec.model, text: text || "(порожня відповідь)" };
    }

    if (spec.provider === "openrouter") {
      // OpenRouter Vision: дозволяє просто передати image_url
      const content = [{ type: "text", text: prompt }];
      for (const img of norm) {
        if (img.type === "url") {
          content.push({ type: "image_url", image_url: { url: img.value } });
        } else {
          // inline base64 (data:...) теж дозволено
          const mime = img.mime || "image/jpeg";
          content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${img.value}` } });
        }
      }

      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: spec.model, // напр., "google/gemini-2.0-flash-exp:free" або інша віжн-модель
          messages: [{ role: "user", content }],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`OpenRouter ${res.status} ${JSON.stringify(data)}`);
      const text = data?.choices?.[0]?.message?.content || "";
      return { ok: true, provider: spec.provider, model: spec.model, text: text || "(порожня відповідь)" };
    }

    throw new Error("Unknown vision provider");
  } catch (e) {
    return { ok: false, error: String(e?.message || e), provider: spec.provider, model: spec.model };
  }
}