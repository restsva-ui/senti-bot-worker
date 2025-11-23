//////////////////////////////
// utils.js — базові утиліти
//////////////////////////////

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function safe(obj, fallback = {}) {
  try {
    return JSON.parse(obj);
  } catch {
    return fallback;
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function log(...args) {
  console.log("[SENTI]", ...args);
}
