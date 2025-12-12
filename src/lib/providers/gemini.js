// src/lib/providers/gemini.js
import { sleep } from "../utils/sleep.js";
import { diagWrap } from "../diag.js";

function geminiEndpoint(env) {
  const v = String(env?.GEMINI_API_VERSION || "v1").trim();
  return `https://generativelanguage.googleapis.com/${v}`;
}

export const callGemini = diagWrap("gemini", async ({ env, model, messages, safety }) => {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");

  const url = `${geminiEndpoint(env)}/models/${model}:generateContent?key=${key}`;

  const contents = [];
  // messages: [{role:'user'|'assistant', content:[{type:'text',text}]}]
  for (const m of messages || []) {
    const parts = [];
    for (const c of m.content || []) {
      if (c.type === "text") parts.push({ text: c.text || "" });
      else if (c.type === "image_url") {
        // Gemini expects inline_data or file_data; у нас image_url зазвичай обробляється вище.
        // Лишаємо як текстове посилання (стабільно).
        parts.push({ text: c.image_url?.url ? `Image: ${c.image_url.url}` : "Image: (missing url)" });
      }
    }
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts,
    });
  }

  const body = {
    contents,
  };

  if (safety) body.safetySettings = safety;

  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error?.message || `${res.status} ${res.statusText}`;
        throw new Error(`gemini ${res.status} ${msg}`);
      }
      return data;
    } catch (e) {
      lastErr = e;
      await sleep(250 * attempt);
    }
  }

  throw lastErr || new Error("gemini failed");
});