// src/routes/brainFallbacks.js
// Фолбеки для /api/brain/* — використовуються, якщо handleBrainApi не повернув респонс

import { listArchives, getArchive } from "../lib/kvChecklist.js";
import { json, CORS } from "../utils/http.js";

// fallback: /api/brain/current
export async function fallbackBrainCurrent(env) {
  try {
    const cur = await env?.CHECKLIST_KV?.get?.("brain:current");
    return json({ ok: true, current: cur || null, exists: !!cur }, 200, CORS);
  } catch {
    return json({ ok: true, current: null, exists: false }, 200, CORS);
  }
}

// fallback: /api/brain/list
export async function fallbackBrainList(env) {
  const items = await listArchives(env).catch(() => []);
  const arr = Array.isArray(items) ? items : items?.items || [];
  return json({ ok: true, total: arr.length, items: arr }, 200, CORS);
}

// fallback: /api/brain/get
export async function fallbackBrainGet(env, key) {
  if (!key) return json({ ok: false, error: "key required" }, 400, CORS);
  const b64 = await getArchive(env, key).catch(() => null);
  if (!b64) return json({ ok: false, error: "not found" }, 404, CORS);

  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Response(bin, {
    headers: {
      ...CORS,
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${key.split("/").pop()}"`,
    },
  });
}