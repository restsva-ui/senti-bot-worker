// src/lib/providers/workersAi.js
// Cloudflare Workers AI provider (text & vision)

function sanitizeBase64(b64 = "") {
  return String(b64).replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
}

export async function call_cfText(env, model, userPrompt, { systemHint, temperature = 0.2, max_tokens = 512 }) {
  const accountId = env.CF_ACCOUNT_ID;
  const token = env.CF_AI_TOKEN || env.CLOUDFLARE_API_TOKEN || env.CF_AUTH_TOKEN;
  if (!accountId || !token) throw new Error("CF credentials missing");

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encodeURIComponent(model)}`;

  const messages = [];
  if (systemHint) messages.push({ role: "system", content: systemHint });
  messages.push({ role: "user", content: userPrompt });

  const r = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      temperature,
      max_tokens,
    })
  });

  if (!r.ok) {
    const t = await safeErr(r);
    throw new Error(`cf:text ${r.status} ${t}`);
  }
  const j = await r.json();
  const text = j?.result?.response || j?.result?.output_text || "";
  return String(text || "").trim();
}

export async function call_cfVision(env, model, userPrompt, {
  systemHint,
  imageBase64,
  imageMime = "image/jpeg",
  temperature = 0.2,
  max_tokens = 700,
  json = false,
}) {
  const accountId = env.CF_ACCOUNT_ID;
  const token = env.CF_AI_TOKEN || env.CLOUDFLARE_API_TOKEN || env.CF_AUTH_TOKEN;
  if (!accountId || !token) throw new Error("CF credentials missing");

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encodeURIComponent(model)}`;
  const base64 = sanitizeBase64(imageBase64);
  const messages = [{
    role: "user",
    content: [
      { type: "input_text", text: String(userPrompt || "") },
      // нові ревізії приймають image object з mime_type; старим не заважає
      { type: "input_image", image: { data: base64, mime_type: imageMime } },
    ]
  }];
  if (systemHint) messages.unshift({ role: "system", content: String(systemHint) });

  const r = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      temperature,
      max_tokens,
      ...(json ? { response_format: { type: "json_object" } } : {})
    })
  });

  if (!r.ok) {
    const t = await safeErr(r);
    throw new Error(`cf:vision ${r.status} ${t}`);
  }
  const j = await r.json();
  const text = j?.result?.response || j?.result?.output_text || "";
  return String(text || "").trim();
}

async function safeErr(r) {
  try { return await r.text(); } catch { return ""; }
}