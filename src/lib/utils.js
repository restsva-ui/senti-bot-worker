// src/lib/utils.js

/** JSON-відповідь (з правильним content-type) */
export function json(data, init = {}) {
  const body = typeof data === "string" ? data : JSON.stringify(data);
  const headers = new Headers(init.headers || {});
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  return new Response(body, { ...init, headers });
}

/** Текстова відповідь */
export function text(str, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("content-type")) {
    headers.set("content-type", "text/plain; charset=utf-8");
  }
  return new Response(String(str), { ...init, headers });
}

/** Обгортка з таймаутом для будь-якого проміса */
export function withTimeout(promise, ms = 8000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout exceeded")), ms)),
  ]);
}

/** Безпечний fetch з таймаутом; при збої повертає null */
export async function safeFetch(input, init = {}, ms = 8000) {
  try {
    return await withTimeout(fetch(input, init), ms);
  } catch {
    return null;
  }
}

export const ok = (data) => json({ ok: true, ...data });
export const err = (message = "error", code = 500) =>
  json({ ok: false, error: String(message) }, { status: code });
