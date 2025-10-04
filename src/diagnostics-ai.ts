export function health() {
  return json({ ok: true, time: new Date().toISOString() });
}

export async function handleDiagnostics(req: Request, env: any, url: URL) {
  if (url.pathname === "/env") {
    return json({
      ok: true,
      has: {
        BOT_TOKEN: !!env.BOT_TOKEN,
        WEBHOOK_SECRET: !!env.WEBHOOK_SECRET || !!env.TELEGRAM_SECRET_TOKEN,
        SENTI_CACHE: !!env.SENTI_CACHE,
        CF_API_TOKEN: !!env.CLOUDFLARE_API_TOKEN || !!env.CF_VISION,
        CF_ACCOUNT_ID: !!env.CLOUDFLARE_ACCOUNT_ID || !!env.CF_ACCOUNT_ID,
        LIKES_KV: !!env.LIKES_KV,
        DEDUP_KV: !!env.DEDUP_KV,
      },
    });
  }
  return null;
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json;charset=UTF-8" } });
}