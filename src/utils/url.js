// src/utils/url.js

/**
 * Повертає абсолютний URL для воркера за відносним шляхом.
 * Напр.: abs(env, "/admin/repo/html") ->
 *        https://<SERVICE_HOST>/admin/repo/html
 */
export function abs(env, path) {
  if (!env?.SERVICE_HOST) throw new Error("SERVICE_HOST not set");
  if (!path || typeof path !== "string") throw new Error("path required");
  return `https://${env.SERVICE_HOST}${path.startsWith("/") ? "" : "/"}${path}`;
}