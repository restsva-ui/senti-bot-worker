// src/utils/http.js

// CORS для публічних/читальних ендпойнтів
export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,HEAD,POST,OPTIONS",
  "access-control-allow-headers":
    "Content-Type,Authorization,x-telegram-bot-api-secret-token",
};

// JSON-відповідь
export const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

// Текстова відповідь
export const text = (body, status = 200, headers = {}) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...headers },
  });

// Обробка preflight
export function handleOptions(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  return null;
}
