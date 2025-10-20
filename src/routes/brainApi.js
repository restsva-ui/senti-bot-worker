// src/routes/brainApi.js
import { listArchives, getArchive } from "../lib/kvChecklist.js";

// ── helpers ───────────────────────────────────────────────────────────────────
const json = (o, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(o, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });

const needSecret = (env, url) =>
  env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET;

const CUR_KEY = "brain:current";

const cors = {
  base: {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,HEAD,POST,OPTIONS",
    "access-control-allow-headers": "Content-Type,Authorization",
  },
  preflight() {
    return new Response(null, { status: 204, headers: this.base });
  },
};

// ── router ────────────────────────────────────────────────────────────────────
export async function handleBrainApi(req, env, url) {
  const p = url.pathname;
  // трактуємо HEAD як GET для читання
  const method = req.method === "HEAD" ? "GET" : req.method;

  // CORS preflight
  if (method === "OPTIONS" || req.method === "OPTIONS") {
    return cors.preflight();
  }

  // GET/HEAD /api/brain/ping — простий ping
  if (p === "/api/brain/ping" && (method === "GET")) {
    return json({ ok: true }, 200, cors.base);
  }

  // GET/HEAD /api/brain/current — хто зараз “актуальний”
  if (p === "/api/brain/current" && (method === "GET")) {
    const current = await env.CHECKLIST_KV.get(CUR_KEY);
    return json({ ok: true, current, exists: !!current }, 200, cors.base);
  }

  // GET/HEAD /api/brain/list — перелік архівів (під секретом)
  if (p === "/api/brain/list" && (method === "GET")) {
    if (needSecret(env, url)) {
      return json({ ok: false, error: "unauthorized" }, 401, cors.base);
    }
    const keys = await listArchives(env); // масив ключів
    return json({ ok: true, total: keys.length, items: keys }, 200, cors.base);
  }

  // GET/HEAD /api/brain/get?key=...&s=... — віддати ZIP (бінарно)
  if (p === "/api/brain/get" && (method === "GET")) {
    if (needSecret(env, url)) {
      return json({ ok: false, error: "unauthorized" }, 401, cors.base);
    }
    const key = url.searchParams.get("key");
    if (!key) return json({ ok: false, error: "key required" }, 400, cors.base);

    const b64 = await getArchive(env, key);
    if (!b64) return json({ ok: false, error: "not found" }, 404, cors.base);

    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new Response(bin, {
      status: 200,
      headers: {
        ...cors.base,
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${key.split("/").pop()}"`,
      },
    });
  }

  // /api/brain/* — інше
  if (p.startsWith("/api/brain")) {
    return json({ ok: false, error: "unknown endpoint" }, 404, cors.base);
  }

  return null; // не наш маршрут
}