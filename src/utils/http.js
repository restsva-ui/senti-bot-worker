// src/utils/http.js

// Загальні CORS-заголовки для читальних/публічних ендпойнтів
export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,HEAD,POST,OPTIONS",
  "access-control-allow-headers": "Content-Type,Authorization,x-telegram-bot-api-secret-token",
};

// JSON-відповідь з можливістю додати/перекрити заголовки
export const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

// HTML-відповідь (без автоматичного додавання CORS, як і було раніше)
export const html = (markup, headers = {}) =>
  new Response(markup, {
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });

// Префлайт для OPTIONS
export const preflight = () => new Response(null, { status: 204, headers: CORS });