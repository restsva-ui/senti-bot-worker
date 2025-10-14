// src/utils/respond.js
export const html = (s, status = 200) =>
  new Response(s, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

export const json = (o, status = 200) =>
  new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });