// src/diagnostics-ai.ts
// Діагностичні GET-ендпоїнти + HTML-сторінка /diagnostics для ручних перевірок.

type MaybeHeaders = HeadersInit | undefined;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function pickEnv(env: Record<string, any>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = (env as any)?.[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

async function fetchJson(url: string, headers?: MaybeHeaders) {
  const r = await fetch(url, { headers });
  const text = await r.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { ok: r.ok, status: r.status, body };
}

/* ---------- Cloudflare Workers AI (models list) ---------- */
async function cfListModels(env: Record<string, any>) {
  const accountId =
    pickEnv(env, "CLOUDFLARE_ACCOUNT_ID", "CF_ACCOUNT_ID", "ACCOUNT_ID") || "";
  const apiToken =
    pickEnv(env, "CLOUDFLARE_API_TOKEN", "CF_API_TOKEN", "API_TOKEN") || "";

  if (!accountId || !apiToken) {
    return json(
      {
        ok: false,
        provider: "cloudflare-ai",
        configured: false,
        missing: {
          accountId: !accountId,
          apiToken: !apiToken,
        },
        hint:
          "Заповни CLOUDFLARE_ACCOUNT_ID (або CF_ACCOUNT_ID) та CLOUDFLARE_API_TOKEN у Variables/Secrets.",
      },
      200
    );
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models`;
  const { ok, status, body } = await fetchJson(url, {
    Authorization: `Bearer ${apiToken}`,
  });

  return json(
    {
      ok,
      provider: "cloudflare-ai",
      status,
      endpoint: "/diagnostics/ai/cf-vision",
      models: body?.result ?? body,
    },
    ok ? 200 : 502
  );
}

/* ---------- Gemini ---------- */
async function geminiModels(env: Record<string, any>) {
  const apiKey = pickEnv(env, "GEMINI_API_KEY", "GOOGLE_API_KEY");
  if (!apiKey) {
    return json(
      {
        ok: false,
        provider: "gemini",
        configured: false,
        missing: { GEMINI_API_KEY: true },
        hint: "Додай GEMINI_API_KEY до Secrets у воркері.",
      },
      200
    );
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
    apiKey
  )}`;
  const { ok, status, body } = await fetchJson(url);
  return json(
    {
      ok,
      provider: "gemini",
      status,
      models: body?.models ?? body,
    },
    ok ? 200 : 502
  );
}

async function geminiPing(env: Record<string, any>) {
  const apiKey = pickEnv(env, "GEMINI_API_KEY", "GOOGLE_API_KEY");
  if (!apiKey) {
    return json(
      {
        ok: false,
        provider: "gemini",
        configured: false,
        missing: { GEMINI_API_KEY: true },
      },
      200
    );
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
    apiKey
  )}`;
  const { ok, status } = await fetchJson(url);
  return json(
    {
      ok,
      provider: "gemini",
      status,
      message: ok ? "Gemini reachable ✅" : "Gemini unreachable ❌",
    },
    ok ? 200 : 502
  );
}

/* ---------- OpenRouter ---------- */
async function openrouterModels(env: Record<string, any>) {
  const key = pickEnv(env, "OPENROUTER_API_KEY", "OR_API_KEY");
  if (!key) {
    return json(
      {
        ok: false,
        provider: "openrouter",
        configured: false,
        missing: { OPENROUTER_API_KEY: true },
        hint: "Додай OPENROUTER_API_KEY до Secrets у воркері.",
      },
      200
    );
  }
  const url = "https://openrouter.ai/api/v1/models";
  const { ok, status, body } = await fetchJson(url, {
    Authorization: `Bearer ${key}`,
  });
  return json(
    {
      ok,
      provider: "openrouter",
      status,
      models: body?.data ?? body,
    },
    ok ? 200 : 502
  );
}

/* ---------- Info для фотопотоку ---------- */
function photosInfo() {
  return json({
    ok: true,
    topic: "photos",
    howto: [
      "1) Надішли фото боту в Telegram.",
      "2) Потім — коротку текстову підказку (наприклад: 'Що на фото?').",
      "Бот збереже 'останні фото' у KV та проаналізує разом із підказкою.",
    ],
    endpoints: { tg_flow: "Telegram → photo → prompt" },
  });
}

/* ---------- HTML /diagnostics ---------- */
function htmlDiagnosticsPage(origin: string) {
  const html = `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Senti — Diagnostics</title>
<style>
  :root{color-scheme:light dark}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;margin:0;padding:16px;line-height:1.45}
  h1{margin:0 0 12px}
  .grid{display:grid;gap:12px}
  .card{border:1px solid rgba(0,0,0,.15);border-radius:10px;padding:14px}
  button{cursor:pointer;border-radius:8px;border:1px solid rgba(0,0,0,.2);padding:10px 12px;background:transparent}
  button:hover{background:rgba(0,0,0,.06)}
  pre{white-space:pre-wrap;word-break:break-word;background:rgba(0,0,0,.06);padding:12px;border-radius:8px;max-height:50vh;overflow:auto}
  a{color:inherit}
  .muted{opacity:.8;font-size:.95em}
</style>
</head>
<body>
  <h1>🧪 Senti — Diagnostics</h1>
  <p class="muted">Натискай кнопки — відповідь з'явиться нижче у <code>&lt;пре&gt;</code>.</p>

  <div class="grid">
    <div class="card">
      <h3>Загальна перевірка</h3>
      <button data-endpoint="/health">/health</button>
      <button data-endpoint="/diagnostics/ai/provider">/diagnostics/ai/provider</button>
    </div>

    <div class="card">
      <h3>Cloudflare Workers AI</h3>
      <button data-endpoint="/diagnostics/ai/cf-vision">/diagnostics/ai/cf-vision</button>
      <p class="muted">Потребує <code>CLOUDFLARE_ACCOUNT_ID</code> і <code>CLOUDFLARE_API_TOKEN</code>.</p>
    </div>

    <div class="card">
      <h3>Gemini</h3>
      <button data-endpoint="/diagnostics/ai/gemini/models">/diagnostics/ai/gemini/models</button>
      <button data-endpoint="/diagnostics/ai/gemini/ping">/diagnostics/ai/gemini/ping</button>
      <p class="muted">Потребує <code>GEMINI_API_KEY</code>.</p>
    </div>

    <div class="card">
      <h3>OpenRouter</h3>
      <button data-endpoint="/diagnostics/ai/openrouter/models">/diagnostics/ai/openrouter/models</button>
      <p class="muted">Потребує <code>OPENROUTER_API_KEY</code>.</p>
    </div>

    <div class="card">
      <h3>Фото-флоу</h3>
      <button data-endpoint="/diagnostics/photos">/diagnostics/photos</button>
      <p class="muted">У Телеграмі: спочатку фото → потім коротка текстова підказка.</p>
    </div>

    <div class="card">
      <h3>Прямі посилання</h3>
      <ul>
        <li><a href="${origin}/health" target="_blank">${origin}/health</a></li>
        <li><a href="${origin}/diagnostics/ai/provider" target="_blank">${origin}/diagnostics/ai/provider</a></li>
        <li><a href="${origin}/diagnostics/ai/cf-vision" target="_blank">${origin}/diagnostics/ai/cf-vision</a></li>
        <li><a href="${origin}/diagnostics/ai/gemini/models" target="_blank">${origin}/diagnostics/ai/gemini/models</a></li>
        <li><a href="${origin}/diagnostics/ai/gemini/ping" target="_blank">${origin}/diagnostics/ai/gemini/ping</a></li>
        <li><a href="${origin}/diagnostics/ai/openrouter/models" target="_blank">${origin}/diagnostics/ai/openrouter/models</a></li>
        <li><a href="${origin}/diagnostics/photos" target="_blank">${origin}/diagnostics/photos</a></li>
      </ul>
    </div>
  </div>

  <h3>Відповідь</h3>
  <pre id="out">—</pre>

<script>
  const out = document.getElementById('out');
  async function call(ep){
    out.textContent = 'Loading ' + ep + ' ...';
    try{
      const r = await fetch(ep, { headers: { 'accept':'application/json' }});
      const t = await r.text();
      try { out.textContent = JSON.stringify(JSON.parse(t), null, 2); }
      catch { out.textContent = t; }
    }catch(e){
      out.textContent = 'Error: ' + (e && e.message || e);
    }
  }
  document.querySelectorAll('button[data-endpoint]')
    .forEach(b => b.addEventListener('click', () => call(b.dataset.endpoint)));
</script>
</body>
</html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

/* ---------- Публічна оболонка ---------- */
export async function handleDiagnostics(
  request: Request,
  env: Record<string, any>,
  url: URL
): Promise<Response | null> {
  if (request.method !== "GET") return null;
  if (url.pathname === "/diagnostics") {
    const origin = `${url.protocol}//${url.host}`;
    return htmlDiagnosticsPage(origin);
  }
  if (!url.pathname.startsWith("/diagnostics")) return null;

  // /diagnostics/ai/provider
  if (url.pathname === "/diagnostics/ai/provider") {
    const accountId =
      pickEnv(env, "CLOUDFLARE_ACCOUNT_ID", "CF_ACCOUNT_ID", "ACCOUNT_ID") || null;
    const cfToken =
      pickEnv(env, "CLOUDFLARE_API_TOKEN", "CF_API_TOKEN", "API_TOKEN") || null;
    const hasGemini = !!pickEnv(env, "GEMINI_API_KEY", "GOOGLE_API_KEY");
    const hasOpenRouter = !!pickEnv(env, "OPENROUTER_API_KEY", "OR_API_KEY");

    return json({
      ok: true,
      provider: "summary",
      cloudflare: {
        accountId,
        hasApiToken: !!cfToken,
      },
      gemini: { configured: hasGemini },
      openrouter: { configured: hasOpenRouter },
      endpoints: [
        "/diagnostics/ai/cf-vision",
        "/diagnostics/ai/gemini/models",
        "/diagnostics/ai/gemini/ping",
        "/diagnostics/ai/openrouter/models",
      ],
    });
  }

  if (url.pathname === "/diagnostics/ai/cf-vision") {
    return await cfListModels(env);
  }

  if (url.pathname === "/diagnostics/ai/gemini/models") {
    return await geminiModels(env);
  }

  if (url.pathname === "/diagnostics/ai/gemini/ping") {
    return await geminiPing(env);
  }

  if (url.pathname === "/diagnostics/ai/openrouter/models") {
    return await openrouterModels(env);
  }

  if (url.pathname === "/diagnostics/photos") {
    return photosInfo();
  }

  return json({ ok: false, error: "diagnostics: not found" }, 404);
}