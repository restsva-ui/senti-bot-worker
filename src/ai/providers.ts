// src/ai/providers.ts

// Узгоджений формат відповіді для діагностики/ручних перевірок
export function ok<T = unknown>(data: T, status = 200) {
  return new Response(JSON.stringify({ ok: true, status, data }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function err(message: string, status = 500) {
  return new Response(JSON.stringify({ ok: false, status, error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

type EnvLike = Record<string, string | undefined>;

/* -------------------------- GEMINI -------------------------- */

function getGeminiKey(env: EnvLike) {
  // Підтримуємо обидві змінні — як інколи заводять у різних проєктах
  return env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
}

export async function geminiListModels(env: EnvLike) {
  const key = getGeminiKey(env);
  if (!key) return err("Gemini error: missing GEMINI_API_KEY (or GOOGLE_API_KEY)", 400);

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;

  let raw = "";
  try {
    const res = await fetch(url);
    raw = await res.text();
    if (!res.ok) return err(`Gemini ${res.status}: ${raw || res.statusText}`, res.status);

    let json: any;
    try { json = JSON.parse(raw); } catch {
      return err(`Gemini parse error (models): ${raw.slice(0, 300)}`, 502);
    }
    return ok({ provider: "gemini", models: json.models ?? [], raw: json });
  } catch (e: any) {
    return err(`Gemini error: ${e?.message || e}`);
  }
}

export async function geminiText(
  env: EnvLike,
  model: string,
  prompt: string
) {
  const key = getGeminiKey(env);
  if (!key) return err("Gemini error: missing GEMINI_API_KEY (or GOOGLE_API_KEY)", 400);
  if (!model) return err("Gemini error: missing 'model' query param", 400);
  if (!prompt) return err("Gemini error: missing 'q' (prompt) query param", 400);

  const url =
    `https://generativelanguage.googleapis.com/v1beta/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  };

  let raw = "";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });

    raw = await res.text();

    // Якщо Google повертає 4xx/5xx з порожнім тілом, не падаємо на JSON.parse
    if (!res.ok) return err(`Gemini ${res.status}: ${raw || res.statusText}`, res.status);

    let json: any;
    try { json = JSON.parse(raw); } catch {
      return err(`Gemini parse error: ${raw.slice(0, 300)}`, 502);
    }

    const text =
      json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).join("") ??
      json?.candidates?.[0]?.content?.parts?.[0]?.text ??
      "";

    if (!text) {
      // Повертаємо сирий JSON для простішого дебагу
      return err(`Gemini empty text. Raw: ${raw.slice(0, 500)}`, 502);
    }

    return ok({ provider: "gemini", model, text, raw: json });
  } catch (e: any) {
    return err(`Gemini error: ${e?.message || e}`);
  }
}

/* -------------------------- CF VISION -------------------------- */

export async function cfVision(
  env: EnvLike,
  imgUrl: string,
  prompt = "Describe the image in detail"
) {
  const accountId = env.CF_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;

  if (!accountId) return err("CF Vision error: missing CF_ACCOUNT_ID", 400);
  if (!token) return err("CF Vision error: missing CLOUDFLARE_API_TOKEN", 400);
  if (!imgUrl) return err("CF Vision error: missing 'img' query param", 400);

  // Модель з підтримкою image+text. Підійде стабільна llava 1.5 7B (Workers AI)
  const model = "@cf/llava-hf/llava-1.5-7b-hf";
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    accountId as string
  )}/ai/run/${encodeURIComponent(model)}`;

  const payload = {
    // Workers AI приймає зовнішні URL-и зображень у цьому форматі
    image: imgUrl,
    prompt,
  };

  let raw = "";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
    });

    raw = await res.text();
    if (!res.ok) return err(`CF Vision ${res.status}: ${raw || res.statusText}`, res.status);

    let json: any;
    try { json = JSON.parse(raw); } catch {
      return err(`CF Vision parse error: ${raw.slice(0, 300)}`, 502);
    }

    const text =
      json?.result?.description ??
      json?.result?.output ??
      json?.result?.[0]?.text ??
      json?.result?.text ??
      "";

    if (!text) {
      return err(`CF Vision empty text. Raw: ${raw.slice(0, 500)}`, 502);
    }

    return ok({ provider: "cf-vision", text, raw: json });
  } catch (e: any) {
    return err(`CF Vision error: ${e?.message || e}`);
  }
}

/* -------------------------- TEXT ROUTER -------------------------- */
/** Простий роутер для /ai/text/:provider */
export async function aiTextRouter(
  env: EnvLike,
  provider: string,
  prompt: string,
  opts: { model?: string } = {}
) {
  if (provider === "gemini") {
    return geminiText(env, opts.model || "models/gemini-2.5-flash", prompt);
  }
  return err(`Unknown text provider: ${provider}`, 400);
}