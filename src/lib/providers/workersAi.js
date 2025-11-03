// src/lib/providers/workersAi.js
// Cloudflare Workers AI provider (text & vision) — із ретраями і стабільним форматом messages

function sanitizeBase64(b64 = "") {
  return String(b64).replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getCfAuth(env) {
  const accountId =
    env.CF_ACCOUNT_ID ||
    env.CLOUDLARE_ACCOUNT_ID ||      // на випадок друкарських помилок у ENV
    env.CLOUDFLARE_ACCOUNT_ID;

  const token =
    env.CF_AI_TOKEN ||
    env.CLOUDFLARE_API_TOKEN ||
    env.CF_AUTH_TOKEN;

  if (!accountId) throw new Error("CF credentials missing: CF_ACCOUNT_ID");
  if (!token)     throw new Error("CF credentials missing: CLOUDFLARE_API_TOKEN / CF_AI_TOKEN");
  return { accountId, token };
}

function cfUrl(accountId, model) {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${encodeURIComponent(model)}`;
}

// Уніфікований парсер тексту з відповіді CF (моделі повертають різні поля)
function extractCfText(json) {
  return (
    json?.result?.output_text ||
    json?.result?.response ||
    json?.result?.message?.content?.[0]?.text ||
    ""
  );
}

// Ретраї з квадратичним бекофом: 250ms, 1s, 2.25s
async function fetchWithRetry(url, init, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, init).catch(e => ({ ok: false, status: 0, _err: e }));
    if (res.ok) return res;
    last = res;

    // Класифікація: не ретраїмо на 400/404/415 (неправильний формат або відсутня модель)
    const s = res.status || 0;
    if (s === 400 || s === 404 || s === 415) break;
    await sleep(250 * (i + 1) * (i + 1));
  }
  return last;
}

async function safeErr(r) {
  try { return await r.text(); } catch { return ""; }
}
// ─────────────────────────────────────────────────────────────────────────────
// TEXT

export async function call_cfText(env, model, userPrompt, {
  systemHint,
  temperature = 0.2,
  max_tokens = 512
} = {}) {
  const { accountId, token } = getCfAuth(env);
  const url = cfUrl(accountId, model);

  // Стабільний формат messages (масив content-об'єктів)
  const messages = [
    systemHint ? { role: "system", content: [{ type: "text", text: String(systemHint) }] } : undefined,
    { role: "user", content: [{ type: "text", text: String(userPrompt ?? "") }] }
  ].filter(Boolean);

  const init = {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      temperature,
      // CF приймає і max_tokens, і max_output_tokens. Вкажемо обидва — кого не знатиме, проігнорує.
      max_tokens,
      max_output_tokens: max_tokens
    })
  };

  const r = await fetchWithRetry(url, init, 3);
  if (!r.ok) {
    const t = await safeErr(r);
    throw new Error(`cf:text ${r.status} ${t}`);
  }
  let j = {};
  try { j = await r.json(); } catch {}
  return String(extractCfText(j) || "").trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// VISION

export async function call_cfVision(env, model, userPrompt, {
  systemHint,
  imageBase64,
  imageMime = "image/jpeg",
  temperature = 0.2,
  max_tokens = 700,
  json = false
} = {}) {
  const { accountId, token } = getCfAuth(env);
  const url = cfUrl(accountId, model);

  // Найстабільніший шлях для Llama-3.2-11b-vision — через image_url з data URL
  const dataUrl = `data:${imageMime};base64,${sanitizeBase64(imageBase64 || "")}`;

  const messages = [
    systemHint ? { role: "system", content: [{ type: "text", text: String(systemHint) }] } : undefined,
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: dataUrl } },
        ...(userPrompt ? [{ type: "text", text: String(userPrompt) }] : [])
      ]
    }
  ].filter(Boolean);

  const init = {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      temperature,
      max_tokens,
      max_output_tokens: max_tokens,
      ...(json ? { response_format: { type: "json_object" } } : {})
    })
  };

  const r = await fetchWithRetry(url, init, 3);
  if (!r.ok) {
    const t = await safeErr(r);
    throw new Error(`cf:vision ${r.status} ${t}`);
  }
  let j = {};
  try { j = await r.json(); } catch {}
  return String(extractCfText(j) || "").trim();
}