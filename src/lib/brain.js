// src/lib/brain.js
// "Мозок" Senti:
// 1) Якщо задано MODEL_ORDER — йдемо через роутер (Gemini / CF / OpenRouter в будь-якому порядку).
// 2) Якщо MODEL_ORDER немає — пробуємо Gemini (GEMINI_API_KEY або GOOGLE_API_KEY),
//    потім OpenRouter, далі м’який фолбек.
// 3) aiDiag(env) — активна діагностика провайдерів.

import { askAnyModel } from "../lib/modelRouter.js";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/* ── helpers ─────────────────────────────────────────────────────────────── */
async function tryGeminiDirect(env, text, systemHint, opts = {}) {
  const key = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!key) return { ok: false, out: null, err: "no_key" };

  const modelId = "gemini-1.5-flash-latest";
  const url = `${GEMINI_BASE}/${encodeURIComponent(modelId)}:generateContent?key=${key}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: systemHint ? `${systemHint}\n\n${text}` : text }],
      },
    ],
    generationConfig: {
      temperature: opts.temperature ?? 0.6,
      maxOutputTokens: opts.max_tokens ?? 1024,
    },
  };

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, out: null, err: `HTTP ${r.status}: ${j?.error?.message || j?.error?.status || "gemini_error"}` };
    const out = j?.candidates?.[0]?.content?.parts?.[0]?.text || null;
    return { ok: !!out, out, err: out ? null : "empty" };
  } catch (e) {
    return { ok: false, out: null, err: String(e) };
  }
}

async function tryOpenRouterDirect(env, text, systemHint, opts = {}) {
  if (!env.OPENROUTER_API_KEY) return { ok: false, out: null, err: "no_key" };

  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL || "deepseek/deepseek-chat",
        messages: [
          ...(systemHint ? [{ role: "system", content: systemHint }] : []),
          { role: "user", content: text },
        ],
        temperature: opts.temperature ?? 0.6,
        max_tokens: opts.max_tokens ?? 1024,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, out: null, err: `HTTP ${r.status}: ${j?.error?.message || j?.error || "openrouter_error"}` };
    const out = j?.choices?.[0]?.message?.content || null;
    return { ok: !!out, out, err: out ? null : "empty" };
  } catch (e) {
    return { ok: false, out: null, err: String(e) };
  }
}

/* ── public: основна відповідь ───────────────────────────────────────────── */
export async function think(env, userText, systemHint = "") {
  const text = String(userText || "").trim();
  if (!text) return "🤖 Дай мені текст або запитання — і я відповім.";

  // 0) Якщо заданий порядок провайдерів — пробуємо через роутер
  if (env.MODEL_ORDER) {
    try {
      const merged = systemHint ? `${systemHint}\n\nКористувач: ${text}` : text;
      return await askAnyModel(env, merged, { temperature: 0.6, max_tokens: 1024 });
    } catch (e) {
      // продовжимо резервами
      console.log("Router failed:", e?.message || e);
    }
  }

  // 1) Gemini напряму
  const g = await tryGeminiDirect(env, text, systemHint, { temperature: 0.6, max_tokens: 1024 });
  if (g.ok && g.out) return g.out;

  // 2) OpenRouter напряму
  const o = await tryOpenRouterDirect(env, text, systemHint, { temperature: 0.6, max_tokens: 1024 });
  if (o.ok && o.out) return o.out;

  // 3) М’який фолбек з підказками, чому не спрацювало
  const tips = [];
  if (!env.GEMINI_API_KEY && !env.GOOGLE_API_KEY) tips.push("• Додай GEMINI_API_KEY або GOOGLE_API_KEY (AI Studio)");
  if (!env.OPENROUTER_API_KEY) tips.push("• Або OPENROUTER_API_KEY (+ OPENROUTER_MODEL, за бажання)");
  if (!env.CF_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) tips.push("• Або увімкни Cloudflare Workers AI (CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN) і задай MODEL_ORDER");

  return (
    "🧠 Поки що я працюю у легкому режимі без зовнішніх моделей.\n" +
    (tips.length ? "Як увімкнути безкоштовно:\n" + tips.join("\n") + "\n" : "") +
    "Можеш задати порядок у MODEL_ORDER (напр.: gemini:gemini-1.5-flash-latest,cf:@cf/meta/llama-3-8b-instruct,openrouter:deepseek/deepseek-chat)."
  );
}

/* ── public: діагностика ────────────────────────────────────────────────── */
export async function aiDiag(env) {
  const present = {
    GEMINI_API_KEY: !!env.GEMINI_API_KEY,
    GOOGLE_API_KEY: !!env.GOOGLE_API_KEY,
    CF_ACCOUNT_ID: !!env.CF_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: !!env.CLOUDFLARE_API_TOKEN,
    OPENROUTER_API_KEY: !!env.OPENROUTER_API_KEY,
    OPENROUTER_MODEL: env.OPENROUTER_MODEL || "",
    MODEL_ORDER: env.MODEL_ORDER || "",
  };

  const results = {};

  // Gemini quick check
  if (present.GEMINI_API_KEY || present.GOOGLE_API_KEY) {
    const ping = await tryGeminiDirect(env, "ping", "", { temperature: 0.1, max_tokens: 16 });
    results.gemini = ping.ok
      ? { ok: true, sample: (ping.out || "").slice(0, 80) }
      : { ok: false, err: ping.err };
  } else {
    results.gemini = { ok: false, err: "no_key" };
  }

  // Cloudflare quick check (безпечно: короткий prompt)
  if (present.CF_ACCOUNT_ID && present.CLOUDFLARE_API_TOKEN) {
    try {
      const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${encodeURIComponent("@cf/meta/llama-3-8b-instruct")}`;
      const r = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: [{ role: "user", content: "ping" }] }),
      });
      const j = await r.json().catch(() => ({}));
      results.cloudflare = r.ok && j?.success !== false
        ? { ok: true, sample: (j?.result?.response || j?.result?.output_text || "").slice(0, 80) }
        : { ok: false, err: j?.errors?.[0]?.message || "no_route_or_denied" };
    } catch (e) {
      results.cloudflare = { ok: false, err: String(e) };
    }
  } else {
    results.cloudflare = { ok: false, err: "no_creds" };
  }

  // OpenRouter quick check
  if (present.OPENROUTER_API_KEY) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: present.OPENROUTER_MODEL || "deepseek/deepseek-chat",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 16,
        }),
      });
      const j = await r.json().catch(() => ({}));
      results.openrouter = r.ok
        ? { ok: true, sample: (j?.choices?.[0]?.message?.content || "").slice(0, 80) }
        : { ok: false, err: j?.error?.message || "denied_or_no_funds" };
    } catch (e) {
      results.openrouter = { ok: false, err: String(e) };
    }
  } else {
    results.openrouter = { ok: false, err: "no_key" };
  }

  return { present, results };
}