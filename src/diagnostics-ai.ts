// src/diagnostics-ai.ts
/**
 * ЛЕГКА діагностика для воркера.
 * ВАЖЛИВО: тут ми НІКОЛИ не читаємо request.body — тільки GET і query params.
 * Інакше з'являється помилка "Body has already been used".
 */

type JsonLike = Record<string, unknown> | Array<unknown> | string | number | boolean | null;

function json(res: JsonLike, status = 200): Response {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function guardOK(env: any, url: URL): boolean {
  const expected = (env.WEBHOOK_SECRET || "").trim();
  const got = (url.searchParams.get("secret") || "").trim();
  return expected && got && expected === got;
}

async function tgCall(token: string, method: string, payload?: Record<string, unknown>) {
  const apiBase = "https://api.telegram.org";
  const res = await fetch(`${apiBase}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function handleDiagnostics(
  request: Request,
  env: any,
  url: URL
): Promise<Response | null> {
  // 🔒 тільки GET-діагностика без читання тіла запиту
  if (request.method !== "GET") return null;

  // ————— ПУБЛІЧНІ/НЕЧУТЛИВІ ШЛЯХИ МОЖНА ДОДАВАТИ ТУТ (за потреби) —————

  // 🔐 усе нижче — лише за секретом
  if (!guardOK(env, url)) return null;

  // 1) /debug-headers — подивитися заголовки запиту (без body)
  if (url.pathname === "/debug-headers") {
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => (headers[k] = v));
    return json({
      ok: true,
      path: url.pathname,
      method: request.method,
      headers,
      query: Object.fromEntries(url.searchParams.entries()),
    });
  }

  // 2) /echo-query — повертає всі query-параметри як є
  if (url.pathname === "/echo-query") {
    return json({
      ok: true,
      query: Object.fromEntries(url.searchParams.entries()),
      hint: "body is never read here; safe for webhook coexistence",
    });
  }

  // 3) /whoami — Telegram getMe
  if (url.pathname === "/whoami") {
    if (!env.BOT_TOKEN) return json({ ok: false, error: "BOT_TOKEN missing" }, 500);
    const r = await tgCall(env.BOT_TOKEN, "getMe");
    return json({ ok: true, ...r });
  }

  // 4) /webhook-info — Telegram getWebhookInfo
  if (url.pathname === "/webhook-info") {
    if (!env.BOT_TOKEN) return json({ ok: false, error: "BOT_TOKEN missing" }, 500);
    const r = await tgCall(env.BOT_TOKEN, "getWebhookInfo");
    return json({ ok: true, ...r });
  }

  // 5) /set-webhook — встановити вебхук на {origin}/webhook (або ?url=)
  //    додаємо секрет для заголовка X-Telegram-Bot-Api-Secret-Token
  if (url.pathname === "/set-webhook") {
    if (!env.BOT_TOKEN) return json({ ok: false, error: "BOT_TOKEN missing" }, 500);

    const explicit = url.searchParams.get("url") || "";
    const hookUrl = explicit || `${url.origin}/webhook`; // наш Worker origin
    const secret = (env.WEBHOOK_SECRET || "").trim();

    const r = await tgCall(env.BOT_TOKEN, "setWebhook", {
      url: hookUrl,
      secret_token: secret || undefined,
      allowed_updates: ["message", "edited_message", "callback_query", "channel_post", "edited_channel_post"],
      drop_pending_updates: false,
      max_connections: 40,
    });

    return json({
      ok: true,
      action: "setWebhook",
      hookUrl,
      usedSecret: Boolean(secret),
      ...r,
    });
  }

  // 6) /delete-webhook — прибрати вебхук
  if (url.pathname === "/delete-webhook") {
    if (!env.BOT_TOKEN) return json({ ok: false, error: "BOT_TOKEN missing" }, 500);
    const drop = url.searchParams.get("drop") === "1";
    const r = await tgCall(env.BOT_TOKEN, "deleteWebhook", {
      drop_pending_updates: drop,
    });
    return json({ ok: true, action: "deleteWebhook", drop_pending_updates: drop, ...r });
  }

  // 7) /ping-bot — швидка перевірка, що токен працює та API відповідає
  if (url.pathname === "/ping-bot") {
    if (!env.BOT_TOKEN) return json({ ok: false, error: "BOT_TOKEN missing" }, 500);
    const who = await tgCall(env.BOT_TOKEN, "getMe");
    const info = await tgCall(env.BOT_TOKEN, "getWebhookInfo");
    return json({ ok: true, who, webhook: info });
  }

  // нічого діагностичного — нехай далі обробляє index.ts
  return null;
}

export default handleDiagnostics;