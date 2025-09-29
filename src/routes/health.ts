// src/routes/health.ts

export function handleHealth(): Response {
  const body = JSON.stringify({
    ok: true,
    service: "senti-bot-worker",
    ts: Date.now(),
  });
  return new Response(body, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}