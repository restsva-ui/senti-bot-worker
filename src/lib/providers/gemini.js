// src/lib/providers/gemini.js
// Google Gemini provider: text & vision

function sanitizeBase64(b64 = "") {
  return String(b64).replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
}

export async function call_geminiText(env, model, userPrompt, { systemHint, temperature = 0.2, max_tokens = 512 }) {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("Gemini API key missing");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const contents = [];
  if (systemHint) contents.push({ role: "system", parts: [{ text: String(systemHint) }] });
  contents.push({ role: "user", parts: [{ text: String(userPrompt || "") }] });

  const body = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: max_tokens,
    },
  };

  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const msg = await safeErr(r);
    throw new Error(`gemini:text ${r.status} ${msg}`);
  }
  const j = await r.json();
  const text = j?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
  return text.trim();
}

export async function call_geminiVision(env, model, userPrompt, {
  systemHint,
  imageBase64,
  imageMime = "image/jpeg",
  temperature = 0.2,
  max_tokens = 700,
  json = false,
}) {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("Gemini API key missing");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const imgMime = (String(imageMime || "").toLowerCase().startsWith("image/") ? imageMime : "image/jpeg");
  const base64 = sanitizeBase64(imageBase64);

  const userParts = [{ text: String(userPrompt || "") }];
  if (base64) {
    userParts.push({
      inlineData: {
        mimeType: imgMime,            // <- ВАЖЛИВО: реальний MIME
        data: base64,
      }
    });
  }

  const contents = [];
  if (systemHint) contents.push({ role: "system", parts: [{ text: String(systemHint) }] });
  contents.push({ role: "user", parts: userParts });

  const body = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: max_tokens,
      ...(json ? { responseMimeType: "application/json" } : {})
    },
  };

  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const msg = await safeErr(r);
    throw new Error(`gemini:vision ${r.status} ${msg}`);
  }
  const j = await r.json();
  const parts = j?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text || "").join("");
  return text.trim();
}

async function safeErr(r) {
  try { return await r.text(); } catch { return ""; }
}