// src/commands/health.ts
type TgUpdate = any;

async function sendMessage(env: any, chatId: number | string, text: string, replyTo?: number) {
  const url = `${env.API_BASE_URL}/bot${env.BOT_TOKEN}/sendMessage`;
  const body: any = { chat_id: chatId, text, parse_mode: "Markdown" };
  if (replyTo) body.reply_to_message_id = replyTo;

  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) console.warn("sendMessage /health failed", await res.text());
}

function getChatId(update: TgUpdate): number | undefined {
  return update?.message?.chat?.id ?? update?.callback_query?.message?.chat?.id;
}

export async function health(update: TgUpdate, env: any) {
  const chatId = getChatId(update);
  if (!chatId) return;

  // Мінімальний self-check — наявність ключових env
  const ok =
    !!env.BOT_TOKEN &&
    !!env.API_BASE_URL;

  const text = ok ? "✅ Health: *OK*" : "❌ Health: *FAIL*";
  await sendMessage(env, chatId, text, update?.message?.message_id);
}

export const handleHealth = health;
export default health;