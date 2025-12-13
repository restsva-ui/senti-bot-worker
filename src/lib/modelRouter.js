// src/lib/modelRouter.js
// СТАБІЛЬНИЙ router: Gemini → Cloudflare AI → OpenRouter
// FREE-провайдер ПОВНІСТЮ вимкнено (він ламав vision)

import { diagWrap } from "./diag.js";

function splitOrder(str) {
  return String(str || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function pickOrder(env, kind) {
  const key =
    kind === "vision"
      ? "MODEL_ORDER_VISION"
      : kind === "code"
        ? "MODEL_ORDER_CODE"
        : kind === "text"
          ? "MODEL_ORDER_TEXT"
          : "MODEL_ORDER";

  return splitOrder(env?.[key] || env?.MODEL_ORDER || "");
}

function normalize(entry) {
  const s = String(entry || "");
  const i = s.indexOf(":");
  if (i === -1) return { provider: "cf", model: s };
  return { provider: s.slice(0, i), model: s.slice(i + 1) };
}
export async function askAnyModel(env, messages, opts = {}) {
  const order = pickOrder(env, opts.kind || "text");
  const temperature = opts.temperature ?? 0.5;

  const errors = [];

  for (const e of order) {
    const { provider, model } = normalize(e);

    try {
      if (provider === "gemini") {
        return await callGemini({ env, messages, model, temperature });
      }

      if (provider === "cf") {
        return await callCfAi({ env, messages, model, temperature });
      }

      if (provider === "openrouter") {
        if (!env.OPENROUTER_API_KEY) {
          throw new Error("OpenRouter disabled (no API key)");
        }
        return await callOpenRouter({ env, messages, model, temperature });
      }

      throw new Error(`Provider disabled: ${provider}`);
    } catch (err) {
      errors.push(`${provider}:${model} → ${err.message}`);
    }
  }

  throw new Error(errors.join("\n"));
}

export async function askVision(env, prompt, imageUrl) {
  return askAnyModel(
    env,
    [{ role: "user", content: `${prompt}\nImage URL: ${imageUrl}` }],
    { kind: "vision", temperature: 0.2 }
  );
}
// ------------------------------
// Backward compatibility helpers
// ------------------------------

export function safeTrimAnswer(text, max = 3500) {
  if (!text) return "";
  const s = String(text);
  if (s.length <= max) return s;
  return s.slice(0, max - 20).trim() + "\n…";
}
export async function askVisionDiag(env, prompt, imageUrl, opts = {}) {
  return diagWrap(env, async () => {
    return await askVision(env, prompt, imageUrl, opts);
  });
}