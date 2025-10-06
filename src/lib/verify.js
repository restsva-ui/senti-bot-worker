/**
 * Перевірка секрету вебхука.
 * Підтримує офіційний хедер Telegram:
 *   X-Telegram-Bot-Api-Secret-Token
 * і наш резервний:
 *   X-Webhook-Secret
 */
export function verifyWebhookSecret(request, env) {
  const tgHeader = request.headers.get("x-telegram-bot-api-secret-token");
  const altHeader = request.headers.get("x-webhook-secret");
  const expected = env.WEBHOOK_SECRET;

  if (!expected) return false;
  return tgHeader === expected || altHeader === expected;
}