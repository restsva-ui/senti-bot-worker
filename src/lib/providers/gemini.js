// src/lib/providers/gemini.js
// Уніфікований виклик Gemini 2.x (текст/код/візн).
// Працює через REST (generateContent). Передаємо ключ і модель іззовні,
// щоб не залежати від способу зберігання секретів у Worker.

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";

function asGeminiParts(messages = []) {
  // Очікуємо масив {role, content} (роль ігноруємо; все як user)
  // content може бути string або масив частин {type,text|inline_data}
  const parts = [];
  for (const m of messages) {
    if (!m) continue;
    if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (!p) continue;
        if (p.type === "text" || typeof p.text === "string") {
          parts.push({ text: p.text ?? p });
        } else if (p.type === "inline_data" && p.mime_type && p.data) {
          parts.push({ inline_data: { mime_type: p.mime_type, data: p.data } });
        }
      }
    } else if (typeof m.content === "string") {
      parts.push({ text: m.content });
    }
  }
  return parts;
}

export async function callGemini({ apiKey, model, messages = [], imageBase64, temperature = 0.2 }) {
  if (!apiKey) throw new Error("Gemini: missing apiKey");
  if (!model) throw new Error("Gemini: missing model");
  const url = `${GEMINI_ENDPOINT}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const parts = asGeminiParts(messages);

  // Додаємо зображення (якщо є)
  if (imageBase64) {
    parts.push({
      inline_data: { mime_type: "image/png", data: imageBase64 }
    });
  }

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature,
      // можна додати: topK, topP, maxOutputTokens
    }
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Gemini HTTP ${r.status}: ${txt}`);
  }

  const j = await r.json();

  // Витягуємо текст з candidates
  const text =
    j?.candidates?.[0]?.content?.parts
      ?.map(p => (typeof p.text === "string" ? p.text : ""))
      .join("") ?? "";

  return { text, raw: j };
}
