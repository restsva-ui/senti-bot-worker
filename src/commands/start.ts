// src/commands/start.ts
type TgUpdate = any;

async function sendMessage(env: any, chatId: number | string, text: string, replyTo?: number) {
  const url = `${env.API_BASE_URL}/bot${env.BOT_TOKEN}/sendMessage`;
  const body: any = {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  };
  if (replyTo) body.reply_to_message_id = replyTo;

  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) console.warn("sendMessage /start failed", await res.text());
}

function getChatId(update: TgUpdate): number | undefined {
  return update?.message?.chat?.id ?? update?.callback_query?.message?.chat?.id;
}

export async function start(update: TgUpdate, env: any) {
  const chatId = getChatId(update);
  if (!chatId) return;
  const text =
`👋 Привіт! Я *Senti* — бот-асистент.

Корисне:
• \`/help\` — довідка
• \`/wiki\` — введи запит у відповідь або одразу так: \`/wiki  Київ\`, \`/wiki  en  Albert Einstein\`

Порада: надішли *\/wiki* і в наступному повідомленні просто напиши свій запит.`;
  await sendMessage(env, chatId, text, update?.message?.message_id);
}

export const handleStart = start;
export default start;