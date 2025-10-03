// src/commands/stats.ts
type EnvStats = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
  LIKES_KV?: KVNamespace;
};

async function tgFetch(env: EnvStats, method: string, body: Record<string, any>) {
  const base = env.API_BASE_URL || "https://api.telegram.org";
  const url = `${base}/bot${env.BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function statsCommand(env: EnvStats, update: any) {
  const chatId: number | undefined =
    update?.message?.chat?.id ||
    update?.edited_message?.chat?.id ||
    update?.callback_query?.message?.chat?.id;

  if (!chatId) return;

  // Лічильники беремо по ключу для цього чату
  const key = `likes:${chatId}`;
  const raw = (await env.LIKES_KV?.get(key)) || '{"up":0,"down":0}';
  let up = 0, down = 0;
  try {
    const parsed = JSON.parse(raw);
    up = Number(parsed.up) || 0;
    down = Number(parsed.down) || 0;
  } catch {}

  const text = `📊 Статистика лайків у цьому чаті:\n\n👍: ${up}\n👎: ${down}`;
  await tgFetch(env, "sendMessage", { chat_id: chatId, text });
}