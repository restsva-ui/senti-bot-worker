// src/diagnostics-ai.ts
// Діагностичні GET-ендпоїнти для перевірки інтеграцій AI/провайдерів.
// Працює у Cloudflare Workers (без Node-специфіки).

type MaybeHeaders = HeadersInit | undefined;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// Допоміжне: дістаємо значення змінних середовища з можливими синонімами
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
  // Публічний ендпоїнт переліку моделей Gemini
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
  // Простий ping — запит списку моделей з мінімальною відповіддю
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

/* ---------- Простий опис для фото ---------- */
function photosInfo() {
  return json({
    ok: true,
    topic: "photos",
    howto: [
      "1) Надішли фото боту в Telegram.",
      "2) Потім — коротку текстову підказку (наприклад: 'Що на фото?').",
      "Бот збереже 'останні фото' у KV та проаналізує разом із підказкою.",
    ],
    endpoints: {
      tg_flow: "Telegram → photo → prompt",
    },
  });
}

/* ---------- Публічна оболонка ---------- */
export async function handleDiagnostics(
  request: Request,
  env: Record<string, any>,
  url: URL
): Promise<Response | null> {
  if (request.method !== "GET") return null;

  // тільки діагностичні GET-маршрути
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
      note:
        "Це лише перевірка наявності ключів. Для реальної перевірки запустіть інші ендпоїнти нижче.",
      endpoints: [
        "/diagnostics/ai/cf-vision",
        "/diagnostics/ai/gemini/models",
        "/diagnostics/ai/gemini/ping",
        "/diagnostics/ai/openrouter/models",
      ],
    });
  }

  // /diagnostics/ai/cf-vision
  if (url.pathname === "/diagnostics/ai/cf-vision") {
    return await cfListModels(env);
  }

  // /diagnostics/ai/gemini/models
  if (url.pathname === "/diagnostics/ai/gemini/models") {
    return await geminiModels(env);
  }

  // /diagnostics/ai/gemini/ping
  if (url.pathname === "/diagnostics/ai/gemini/ping") {
    return await geminiPing(env);
  }

  // /diagnostics/ai/openrouter/models
  if (url.pathname === "/diagnostics/ai/openrouter/models") {
    return await openrouterModels(env);
  }

  // /diagnostics/photos
  if (url.pathname === "/diagnostics/photos") {
    return photosInfo();
  }

  // Невідомий діагностичний шлях
  return json({ ok: false, error: "diagnostics: not found" }, 404);
}