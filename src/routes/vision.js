// src/routes/vision.js
import { runVision } from "../lib/vision.js";

const json = (o, status = 200) =>
  new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

function ensureSecret(env, url) {
  if (!env.WEBHOOK_SECRET) return true;
  return url.searchParams.get("s") === env.WEBHOOK_SECRET;
}

export async function handleVision(req, env, url) {
  if (url.pathname !== "/api/vision" || req.method !== "POST") return null;

  if (!ensureSecret(env, url)) return json({ ok: false, error: "unauthorized" }, 401);

  let body = {};
  try { body = await req.json(); } catch {}
  const prompt = body?.prompt || "Опиши зображення";
  const images = Array.isArray(body?.images) ? body.images : [];

  const out = await runVision(env, { prompt, images });
  const status = out.ok ? 200 : 400;
  return json(out, status);
}