// src/lib/providers/gemini.js
// Чистий провайдер для Google Generative Language (Gemini).
// Підтримує текст і зображення (vision), systemHint, JSON-режим.

const BASE = "https://generativelanguage.googleapis.com/v1beta";

function getGeminiKey(env) {
  return (
    env.GEMINI_API_KEY ||
    env.GOOGLE_API_KEY ||
    env.GEMINI_KEY ||
    env.GOOGLE_API_KEY_GEMINI || null
  );
}

function buildUrl(model, method, apiKey) {
  const m = encodeURIComponent(model);
  return `${BASE}/models/${m}:${method}?key=${encodeURIComponent(apiKey)}`;
}

function partsFromText(text) {
  return [{ text: String(text ?? "") }];
}

function partsFromImage({ imageBase64, imageMime, prompt }) {
  const parts = [];
  if (imageBase64) {
    parts.push({
      inline_data: {
        mime_type: imageMime || "image/jpeg",
        data: imageBase64.replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, ""),
      },
    });
  }
  if (prompt) parts.push({ text: String(prompt) });
  return parts;
}

function makeBody({ systemHint, contents, temperature, max_tokens, json }) {
  const generationConfig = {};
  if (typeof temperature === "number") generationConfig.temperature = temperature;
  if (typeof max_tokens === "number") generationConfig.maxOutputTokens = max_tokens;
  if (json) generationConfig.responseMimeType = "application/json";

  const body = {
    contents,
    generationConfig,
  };

  if (systemHint && String(systemHint).trim()) {
    body.systemInstruction = {
      role: "system",
      parts: [{ text: String(systemHint) }],
    };
  }
  return body;
}

function extractText(respJson) {
  // Беремо першу кандидатуру і склеюємо всі text-парти
  const cand = respJson?.candidates?.[0];
  const parts = cand?.content?.parts || [];
  return parts.map(p => p?.text || "").join("").trim();
}