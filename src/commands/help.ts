// src/commands/help.ts
type Env = { AI_ENABLED?: string; BOT_TOKEN: string; API_BASE_URL: string };
type Update = { message?: { message_id: number; chat: { id: number } } };

async function reply(env: Env, chatId: number, text: string, replyTo?: number) {
  const url = `${env.API_BASE_URL}/bot${env.BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      reply_to_message_id: replyTo,
    }),
  });
}

export async function help(update: Update, env: Env) {
  const msg = update.message;
  if (!msg) return;

  const aiOn = String(env.AI_ENABLED).toLowerCase() === "true";

  const lines = [
    "ℹ️ *Довідка*",
    "• `/wiki [<lang>] <запит>` — стислий опис з Вікіпедії (uk|ru|en|de|fr)",
    "• `/help` — ця довідка",
  ];

  if (aiOn) {
    lines.splice(1, 0, "• `/ai <запит>` — запит до AI (бета)");
  }

  await reply(env, msg.chat.id, lines.join("\n"), msg.message_id);
}

export default help;