// src/utils/url.js

/** Абсолютний URL до воркера за відносним шляхом */
export function abs(env, path) {
  if (!env?.SERVICE_HOST) throw new Error("SERVICE_HOST not set");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `https://${env.SERVICE_HOST}${p}`;
}
