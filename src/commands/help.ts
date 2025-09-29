// src/commands/help.ts
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
  if (!res.ok) console.warn("sendMessage /help failed", await res.text());
}

function getChatId(update: TgUpdate): number | undefined {
  return update?.message?.chat?.id ?? update?.callback_query?.message?.chat?.id;
}

export async function help(update: TgUpdate, env: any) {
  const chatId = getChatId(update);
  if (!chatId) return;
  const text =
`ℹ️ *Довідка*

Доступні команди:
• \`/wiki [<lang>] <запит>\` — стислий опис з Вікіпедії (мови: uk/ru/en/de/fr)
• \`/help\` — ця довідка

Приклади:
• \`/wiki Київ\`
• \`/wiki en Albert Einstein\``;
  await sendMessage(env, chatId, text, update?.message?.message_id);
}

export const handleHelp = help;
export default help;