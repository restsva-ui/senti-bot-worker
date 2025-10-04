export function health() {
  return json({ ok: true, time: new Date().toISOString() });
}

export function envInfo(env: Record<string, unknown>) {
  return json({
    ok: true,
    has: {
      BOT_TOKEN: !!env.BOT_TOKEN,
      WEBHOOK_SECRET: !!(env as any).WEBHOOK_SECRET || !!(env as any).TELEGRAM_SECRET_TOKEN,
      SENTI_CACHE: !!(env as any).SENTI_CACHE,
      CF_API_TOKEN: !!(env as any).CLOUDFLARE_API_TOKEN || !!(env as any).CF_VISION,
      CF_ACCOUNT_ID: !!(env as any).CLOUDFLARE_ACCOUNT_ID || !!(env as any).CF_ACCOUNT_ID,
      LIKES_KV: !!(env as any).LIKES_KV,
      DEDUP_KV: !!(env as any).DEDUP_KV,
    },
  });
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json;charset=UTF-8" } });
}