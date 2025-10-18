// src/routes/health.js
// Простий Health-ендпоінт: завжди 200 OK, зручний для SelfTest і зовнішніх моніторингів.

const json = (o, status = 200) =>
  new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export async function handleHealth(req, env, url) {
  if (url.pathname === "/health") {
    return json({
      ok: true,
      name: "senti-bot-worker",
      service: env.SERVICE_HOST || "",
      ts: new Date().toISOString(),
    });
  }
  return null; // не цей маршрут
}