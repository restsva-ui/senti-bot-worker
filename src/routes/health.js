// Проста Health-рука, сумісна з викликом handleHealth(req, env, url) у index.js
import { json as jsonResp } from "../utils/respond.js";

// Фолбек, якщо utils/respond.js відсутній:
const json = jsonResp || ((o, status = 200) =>
  new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
);

export async function handleHealth(req, env, url) {
  if (url.pathname === "/health") {
    return json({ ok: true, name: "senti-bot-worker", ts: new Date().toISOString() });
  }
  return null; // не цей маршрут
}