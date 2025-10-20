// src/routes/adminUsage.js
import { abs } from "../utils/url.js";

const JSONH = { "content-type": "application/json; charset=utf-8" };
const HTML  = { "content-type": "text/html; charset=utf-8" };

function secretFromEnv(env) {
  return env.WEBHOOK_SECRET || env.TG_WEBHOOK_SECRET || env.TELEGRAM_WEBHOOK_SECRET || "";
}
function isAuthorized(url, env) {
  const sec = url.searchParams.get("s") || "";
  const need = secretFromEnv(env);
  return !!need && sec === need;
}
function ok(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: JSONH });
}
function bad(msg = "bad request", status = 400) {
  return ok({ ok: false, error: String(msg) }, status);
}

async function r2Totals(env) {
  // ✅ використовуємо правильний біндинг R2 з wrangler.toml: LEARN_BUCKET
  const bucket = env?.LEARN_BUCKET;
  if (!bucket) return { bytes: 0, count: 0 };

  let cursor;
  let bytes = 0, count = 0;
  do {
    const page = await bucket.list({ cursor, limit: 1000 });
    for (const obj of page.objects || []) {
      bytes += obj.size || 0;
      count += 1;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return { bytes, count };
}

async function kvLearnTotals(env) {
  const kv = env?.LEARN_QUEUE_KV;
  if (!kv) return { bytes: 0, count: 0 };

  let cursor;
  let bytes = 0, count = 0;

  // learn:q:* — черга
  do {
    const page = await kv.list({ prefix: "learn:q:", cursor, limit: 1000 });
    for (const k of page.keys || []) {
      const v = await kv.get(k.name);
      if (v) { bytes += new Blob([v]).size; count += 1; }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  // learn:last_summary — останній короткий підсумок
  const last = await kv.get("learn:last_summary");
  if (last) bytes += new Blob([last]).size;

  return { bytes, count };
}

function toHuman(bytes) {
  const units = ["B","KB","MB","GB","TB"];
  let i = 0, v = Number(bytes || 0);
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export async function handleAdminUsage(req, env, url) {
  const p = url.pathname || "";
  if (!p.startsWith("/admin/usage")) return new Response("Not found", { status: 404 });

  if (!isAuthorized(url, env)) return bad("unauthorized", 401);

  if (p === "/admin/usage/json") {
    const r2 = await r2Totals(env).catch(() => ({ bytes:0, count:0 }));
    const kv = await kvLearnTotals(env).catch(() => ({ bytes:0, count:0 }));
    return ok({
      ok: true,
      r2: { ...r2, human: toHuman(r2.bytes) },
      kv_learn: { ...kv, human: toHuman(kv.bytes) },
      total_human: toHuman(r2.bytes + kv.bytes),
    });
  }

  // Легкий HTML огляд
  const jsonUrl = abs(env, "/admin/usage/json?s=" + encodeURIComponent(secretFromEnv(env)));
  const html = `<!doctype html><meta charset="utf-8">
  <title>Storage usage</title>
  <style>
    body{font:14px/1.45 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;background:#0b0d10;color:#e6e9ee;margin:0;padding:16px}
    .muted{color:#9aa3af}
    .card{background:#111418;border:1px solid #1b1f24;border-radius:12px;padding:16px;max-width:880px}
  </style>
  <h1>Storage usage <span class="muted">(R2 + KV)</span></h1>
  <div class="card"><pre id="out">Loading…</pre></div>
  <script>
    fetch(${JSON.stringify(jsonUrl)}).then(r=>r.json()).then(d=>{
      document.getElementById('out').textContent = JSON.stringify(d,null,2);
    }).catch(e=>{document.getElementById('out').textContent=String(e)});
  </script>`;
  return new Response(html, { headers: HTML });
}
