// Unified AI providers (text + vision) with fallbacks.
// Order is controlled by AI_PROVIDERS env var:
//   text:gemini,deepseek,groq;vision:gemini

const G_TEXT = "gemini";
const D_TEXT = "deepseek";
const R_TEXT = "groq";

export function parseProviderOrder(env) {
  const raw = env.AI_PROVIDERS || `text:${G_TEXT},${D_TEXT},${R_TEXT};vision:${G_TEXT}`;
  const parts = Object.fromEntries(
    raw.split(";").map(s => {
      const [k, v] = s.split(":");
      return [k.trim(), v.split(",").map(x => x.trim()).filter(Boolean)];
    })
  );
  return {
    text: parts.text ?? [G_TEXT, D_TEXT, R_TEXT],
    vision: parts.vision ?? [G_TEXT],
  };
}

// ====== TEXT ======
async function geminiText(prompt, env) {
  const model = env.AI_MODEL || "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }]}],
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Gemini text ${r.status}`);
  const data = await r.json();
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("")?.trim() || "🤔";
}

async function deepseekText(prompt, env) {
  if (!env.DEEPSEEK_API_KEY) throw new Error("NO_DEEPSEEK_KEY");
  const url = "https://api.deepseek.com/v1/chat/completions";
  const body = {
    model: "deepseek-chat",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.6,
  };
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`DeepSeek ${r.status}`);
  const data = await r.json();
  return data?.choices?.[0]?.message?.content?.trim() || "🤔";
}

async function groqText(prompt, env) {
  if (!env.GROQ_API_KEY) throw new Error("NO_GROQ_KEY");
  const url = "https://api.groq.com/openai/v1/chat/completions";
  const body = {
    model: "llama-3.1-8b-instant",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.6,
  };
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Groq ${r.status}`);
  const data = await r.json();
  return data?.choices?.[0]?.message?.content?.trim() || "🤔";
}

const TEXT_IMPL = {
  [G_TEXT]: geminiText,
  [D_TEXT]: deepseekText,
  [R_TEXT]: groqText,
};

export async function generateText(prompt, env) {
  const order = parseProviderOrder(env).text;
  let lastErr;
  for (const name of order) {
    const impl = TEXT_IMPL[name];
    if (!impl) continue;
    try {
      return await impl(prompt, env);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("No text providers available");
}

// ====== VISION (image URL array) ======
async function geminiVision(prompt, imageUrls, env) {
  const model = env.AI_MODEL || "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const parts = [{ text: prompt || "Опиши зображення і зроби висновки стисло." }];
  for (const u of imageUrls) {
    parts.push({ inline_data: await fetchAsPart(u) });
  }
  const body = { contents: [{ role: "user", parts }] };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Gemini vision ${r.status}`);
  const data = await r.json();
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("")?.trim() || "🤔";
}

// helper: download bytes and convert to base64 as Gemini inline_data
async function fetchAsPart(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch image ${res.status}`);
  const ct = res.headers.get("content-type") || "image/jpeg";
  const ab = await res.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(ab)));
  return { mime_type: ct, data: b64 };
}

export async function analyzeImage(prompt, imageUrls, env) {
  const order = parseProviderOrder(env).vision; // now only gemini
  let lastErr;
  for (const name of order) {
    try {
      if (name === G_TEXT) return await geminiVision(prompt, imageUrls, env);
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error("No vision providers available");
}