// src/lib/r2.js
import { abs } from "../utils/url.js";

/**
 * Очікується биндинг у wrangler.toml:
 * [[r2_buckets]]
 * binding = "LEARN_BUCKET"
 * bucket_name = "senti-learn"
 */

function bucket(env) {
  const b = env?.LEARN_BUCKET;
  if (!b) throw new Error("LEARN_BUCKET is not bound");
  return b;
}

function randId() {
  return Math.random().toString(36).slice(2);
}

function ymdParts(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return { y, m, d: dd };
}

function sanitizeName(name = "file") {
  // легка санітизація + обрізання
  const base = String(name).replace(/[\r\n]+/g, " ").replace(/[^\w.\- ()\u0400-\u04FF]+/g, "_");
  return base.slice(0, 80) || "file";
}

function buildKey(originalName = "file") {
  const safe = sanitizeName(originalName);
  const { y, m, d } = ymdParts();
  const stamp = Date.now();
  const id = randId();
  return `uploads/${y}/${m}/${d}/${stamp}-${id}-${safe}`;
}

export function isR2Pointer(v) {
  return typeof v === "string" && v.startsWith("r2://");
}
export function parseR2Url(u) {
  if (!isR2Pointer(u)) return null;
  // r2://<key>
  return { key: String(u).slice("r2://".length) };
}

/**
 * URL для завантаження через Worker (бо bucket приватний).
 * Зробимо роут /admin/learn/file/:key (додамо пізніше).
 */
export function getWorkerFileUrl(env, key) {
  // ВАЖЛИВО: key потрібно encodeURIComponent при підстановці в шлях.
  return abs(env, `/admin/learn/file/${encodeURIComponent(key)}`);
}

/**
 * Завантаження з HTML <form enctype="multipart/form-data">
 * Підтримує name="file" або name="files" (multiple).
 * opts: { userId?: string, prefix?: string }
 */
export async function uploadFromFormData(env, formData, opts = {}) {
  const b = bucket(env);
  const userId = String(opts.userId || "anon");
  const results = [];

  // зберемо всі File з formData
  const files = [];
  for (const [name, val] of formData.entries()) {
    if (val instanceof File) files.push(val);
  }
  if (!files.length) return [];

  for (const f of files) {
    const name = f.name || "file";
    const key = `${opts.prefix || ""}${buildKey(name)}`;
    const httpMetadata = {
      contentType: f.type || "application/octet-stream",
      contentDisposition: `inline; filename="${sanitizeName(name)}"`,
    };
    // У Workers R2 .put підтримує ReadableStream (f.stream()).
    await b.put(key, f.stream(), {
      httpMetadata,
      customMetadata: {
        by: userId,
        originalName: name,
      },
    });

    results.push({
      ok: true,
      key,
      size: f.size ?? null,
      name,
      type: f.type || null,
      r2: `r2://${key}`,
      workerUrl: getWorkerFileUrl(env, key),
    });
  }
  return results;
}

/**
 * Завантаження у R2 з будь-якого URL (HTTP GET).
 * opts: { name?: string, userId?: string, prefix?: string, headers?: Record<string,string> }
 */
export async function uploadFromUrl(env, url, opts = {}) {
  const b = bucket(env);
  const userId = String(opts.userId || "system");
  const r = await fetch(url, { headers: opts.headers || {} });
  if (!r.ok) throw new Error(`fetch ${url} failed: ${r.status}`);

  const ctype = r.headers.get("content-type") || "application/octet-stream";
  const clen = Number(r.headers.get("content-length") || 0);
  const nameFromUrl = (() => {
    try {
      const u = new URL(url);
      const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || "");
      return last || "remote-file";
    } catch { return "remote-file"; }
  })();

  const name = sanitizeName(opts.name || nameFromUrl);
  const key = `${opts.prefix || ""}${buildKey(name)}`;

  await b.put(key, r.body, {
    httpMetadata: {
      contentType: ctype,
      contentDisposition: `inline; filename="${sanitizeName(name)}"`,
    },
    customMetadata: {
      by: userId,
      sourceUrl: url,
      originalName: name,
      length: String(clen || ""),
    },
  });

  return {
    ok: true,
    key,
    name,
    type: ctype,
    size: clen || null,
    r2: `r2://${key}`,
    workerUrl: getWorkerFileUrl(env, key),
  };
}

/**
 * Отримати список об'єктів (для адмінки).
 * opts: { prefix?: string, limit?: number, cursor?: string }
 */
export async function listObjects(env, opts = {}) {
  const b = bucket(env);
  const prefix = opts.prefix || "uploads/";
  const limit = Math.min(Math.max(opts.limit || 50, 1), 1000);
  const res = await b.list({ prefix, limit, cursor: opts.cursor });
  const items = (res.objects || []).map(o => ({
    key: o.key,
    size: o.size,
    etag: o.etag,
    uploaded: o.uploaded ? new Date(o.uploaded).toISOString() : null,
    workerUrl: getWorkerFileUrl(env, o.key),
  }));
  return { items, cursor: res.cursor || null, truncated: !!res.truncated };
}

/**
 * Прочитати об’єкт як Response (для проксі-роута /admin/learn/file/:key)
 */
export async function readObjectResponse(env, key) {
  const b = bucket(env);
  const obj = await b.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  if (obj.httpMetadata?.contentType) headers.set("content-type", obj.httpMetadata.contentType);
  if (obj.httpMetadata?.contentDisposition) headers.set("content-disposition", obj.httpMetadata.contentDisposition);
  // кешування опційно:
  headers.set("cache-control", "public, max-age=3600");
  return new Response(obj.body, { status: 200, headers });
}
