// src/utils/url.js
export function abs(env, path = "/") {
  let host = String(env.SERVICE_HOST || "").trim();
  if (!host) {
    // Фолбек (не має сенсу викликати без валідного хоста)
    return String(path || "/");
  }
  // Додаємо протокол, якщо його нема
  if (!/^https?:\/\//i.test(host)) {
    host = "https://" + host;
  }
  return host.replace(/\/+$/, "") + String(path || "/");
}