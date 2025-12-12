// src/utils/http.js
// Сумісний з викликами у src/index.js: json(data, status, CORS), html(content, status, CORS)

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-telegram-bot-api-secret-token",
};

export function preflight(extraHeaders = {}) {
  return new Response(null, {
    status: 204,
    headers: { ...CORS, ...extraHeaders },
  });
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...CORS,
      ...extraHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export function html(content, status = 200, extraHeaders = {}) {
  return new Response(content, {
    status,
    headers: {
      ...CORS,
      ...extraHeaders,
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

export function text(content, status = 200, extraHeaders = {}) {
  return new Response(String(content ?? ""), {
    status,
    headers: {
      ...CORS,
      ...extraHeaders,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}