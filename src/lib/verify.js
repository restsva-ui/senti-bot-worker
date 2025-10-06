// Приймаємо і офіційний хедер, і query-параметр (?secret=...)
export function verifyWebhookSecret(request, env) {
  const header = request.headers.get("x-telegram-bot-api-secret-token");
  const altHeader = request.headers.get("x-webhook-secret");
  const urlSecret = new URL(request.url).searchParams.get("secret");
  const expected = env.WEBHOOK_SECRET;
  if (!expected) return false;
  return header === expected || altHeader === expected || urlSecret === expected;
}