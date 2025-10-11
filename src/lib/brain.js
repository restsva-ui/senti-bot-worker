// Мінімальний "мозок" Senti (стабільна версія з діагностикою):
// 1) Gemini (v1, з автопереходом на v1beta)
// 2) Cloudflare Workers AI (опційно, якщо є ключі)
// 3) OpenRouter (опційно)
// Якщо ключів немає — м'який фолбек повідомлення.

// ---- Константи та утиліти ----
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_VERSIONS = ["v1", "v1beta"]; // порядок спроб

function normGemini(model) {
  return String(model || DEFAULT_GEMINI_MODEL).replace(/-latest$/i, "");
}

function safeJSON(x) {
  try { return JSON.parse(x); } catch { return {}; }
}

// Формат діагностичного тегу
function tag(provider, model, ms, enabled) {
  if (!enabled) return "";
  const pretty = [provider, model].filter(Boolean).join(" ");
  const t = (typeof ms === "number" && isFinite(ms)) ? ` • ${Math.round(ms)}ms` : "";
  return `\n\n[via ${pretty}${t}]`;
}

// Витяг тексту з відповіді Gemini
function extractGeminiText(j) {
  const parts = j?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) return parts.map(p => p?.text || "").join("");
  return j?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// Очікуваний формат для Cloudflare AI: result.response
function extractCFText(j) {
  return j?.result?.response || j?.result?.output_text || j?.response || "";
}

// Очікуваний формат для OpenRouter
function extractORText(j) {
  return j?.choices?.[0]?.message?.content || j?.choices?.[0]?.text || "";
}

// fetch з таймаутом
async function fetchJSON(url, init = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: controller.signal });
    const text = await r.text();
    const json = safeJSON(text);
    return { ok: r.ok, status: r.status, json, raw: text };
  } finally {
    clearTimeout(id);
  }
}

// ---- Провайдери ----

// 1) Gemini: спробувати v1, потім v1beta
async function callGemini({ apiKey, model, userText, systemHint, showTag }) {
  const mdl = normGemini(model);
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: systemHint ? `${systemHint}\n\n${userText}` : userText }],
      },
    ],
    generationConfig: { temperature: 0.6, maxOutputTokens: 1024 },
  };

  let lastErr;
  const started = Date.now();

  for (const ver of GEMINI_VERSIONS) {
    const url = `https://generativelanguage.googleapis.com/${ver}/models/${encodeURIComponent(mdl)}:generateContent?key=${apiKey}`;
    const res = await fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const out = extractGeminiText(res.json);
      if (out) return `${out}${tag("Gemini", mdl, Date.now() - started, showTag)}`;
      lastErr = `empty ${ver}`;
      continue;
    }

    const status = res.status;
    const st = res.json?.error?.status || "";
    // Якщо NOT_FOUND на v1 — пробуємо v1beta (цикл і так піде далі)
    if (status === 404 || st === "NOT_FOUND") {
      lastErr = `404 on ${ver}`;
      continue;
    }
    lastErr = `${status} on ${ver}`;
  }
  throw new Error(`Gemini fail: ${lastErr || "unknown"}`);
}
// 2) Cloudflare Workers AI (опційно)
async function callCloudflareAI({ accountId, apiToken, userText, systemHint, model = "@cf/meta/llama-3.1-8b-instruct", showTag }) {
  if (!accountId || !apiToken) throw new Error("CF AI creds missing");
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encodeURIComponent(model)}`;
  const body = {
    messages: [
      ...(systemHint ? [{ role: "system", content: systemHint }] : []),
      { role: "user", content: userText },
    ],
  };
  const started = Date.now();
  const res = await fetchJSON(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`CF AI ${res.status}`);
  const out = extractCFText(res.json);
  if (!out) throw new Error("CF AI empty");
  return `${out}${tag("Cloudflare AI", model, Date.now() - started, showTag)}`;
}

// 3) OpenRouter (опційно)
async function callOpenRouter({ apiKey, userText, systemHint, model = "deepseek/deepseek-chat", showTag }) {
  if (!apiKey) throw new Error("OpenRouter key missing");
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const body = {
    model,
    messages: [
      ...(systemHint ? [{ role: "system", content: systemHint }] : []),
      { role: "user", content: userText },
    ],
    temperature: 0.7,
  };
  const started = Date.now();
  const res = await fetchJSON(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
  const out = extractORText(res.json);
  if (!out) throw new Error("OpenRouter empty");
  return `${out}${tag("OpenRouter", model, Date.now() - started, showTag)}`;
}

// ---- Публічний API ----
export async function think(env, userText, systemHint = "") {
  const text = String(userText || "").trim();
  if (!text) return "🤖 Дай мені текст або запитання — і я відповім.";

  // 🚀 Примусово вмикаємо діагностичні теги (ігноруємо DIAG_TAGS env)
  const showTag = true;

  // 1) Gemini (AI Studio key)
  const GEMINI_KEY = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (GEMINI_KEY) {
    try {
      const geminiModel = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
      const out = await callGemini({
        apiKey: GEMINI_KEY,
        model: geminiModel,
        userText: text,
        systemHint,
        showTag,
      });
      if (out) return out;
    } catch (e) {
      console.log("Gemini error:", e?.message || e);
    }
  }

  // 2) Cloudflare Workers AI (якщо доступні ключі)
  const CF_ACCOUNT_ID = env.CF_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID;
  const CF_TOKEN = env.CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN;
  if (CF_ACCOUNT_ID && CF_TOKEN) {
    try {
      const cfModel = env.CF_MODEL || "@cf/meta/llama-3.1-8b-instruct";
      const out = await callCloudflareAI({
        accountId: CF_ACCOUNT_ID,
        apiToken: CF_TOKEN,
        userText: text,
        systemHint,
        model: cfModel,
        showTag,
      });
      if (out) return out;
    } catch (e) {
      console.log("Cloudflare AI error:", e?.message || e);
    }
  }

  // 3) OpenRouter
  if (env.OPENROUTER_API_KEY) {
    try {
      const orModel = env.OPENROUTER_MODEL || "deepseek/deepseek-chat";
      const out = await callOpenRouter({
        apiKey: env.OPENROUTER_API_KEY,
        userText: text,
        systemHint,
        model: orModel,
        showTag,
      });
      if (out) return out;
    } catch (e) {
      console.log("OpenRouter error:", e?.message || e);
    }
  }

  // 4) Софт-фолбек
  return (
    "🧠 Поки що я працюю у легкому режимі без зовнішніх моделей.\n" +
    "Додай GEMINI_API_KEY/GOOGLE_API_KEY, або CLOUDFLARE_API_TOKEN + CF_ACCOUNT_ID, або OPENROUTER_API_KEY — і відповіді стануть «розумнішими»."
  );
}