// src/middlewares/verifyWebhook.ts

/**
 * Перевіряє Telegram header "X-Telegram-Bot-Api-Secret-Token".
 * Якщо секрет не заданий — пропускаємо (допомагає в дев-режимі).
 * Якщо секрет не збігається — повертає Response 403.
 * Якщо все ок — повертає null і ланцюжок можна продовжити.
 */
export function verifyWebhook(req: Request, expected?: string): Response | null {
  if (!expected) return null; // секрет не налаштований, не блокуємо
  const got = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (got !== expected) {
    console.warn("Webhook rejected: bad secret token");
    return new Response("forbidden", { status: 403 });
  }
  return null;
}