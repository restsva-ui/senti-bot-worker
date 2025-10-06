export function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function text(body, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("content-type")) {
    headers.set("content-type", "text/plain; charset=utf-8");
  }
  return new Response(body, { ...init, headers });
}

export function badRequest(msg = "Bad Request") {
  return json({ ok: false, error: msg }, { status: 400 });
}

export function unauthorized(msg = "Unauthorized") {
  return json({ ok: false, error: msg }, { status: 401 });
}

export function forbidden(msg = "Forbidden") {
  return json({ ok: false, error: msg }, { status: 403 });
}

export function notFound() {
  return text("Not Found", { status: 404 });
}