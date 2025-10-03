// src/commands/likes.ts
type EnvLike = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
  LIKES_KV?: KVNamespace;
};

type Update = any;

const KEY = (chatId: number) => `likes:${chatId}`;

async function tgFetch(env: EnvLike, method: string, body: Record<string, any>) {
  const base = env.API_BASE_URL || "https://api.telegram.org";
  const url = `${base}/bot${env.BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function keyboard(up: number, down: number) {
  return {
    inline_keyboard: [
      [
        { text: `👍 ${up}`, callback_data: "likes:+1" },
        { text: `👎 ${down}`, callback_data: "likes:-1" },
      ],
    ],
  };
}

async function readCounters(env: EnvLike, chatId: number) {
  const raw = (await env.LIKES_KV?.get(KEY(chatId))) || '{"up":0,"down":0}';
  try {
    const parsed = JSON.parse(raw);
    return { up: Number(parsed.up) || 0, down: Number(parsed.down) || 0 };
  } catch {
    return { up: 0, down: 0 };
  }
}

async function writeCounters(env: EnvLike, chatId: number, up: number, down: number) {
  await env.LIKES_KV?.put(KEY(chatId), JSON.stringify({ up, down }));
}

export async function likesCommand(env: EnvLike, update: Update) {
  const chatId: number | undefined =
    update?.message?.chat?.id ||
    update?.edited_message?.chat?.id ||
    update?.callback_query?.message?.chat?.id;

  if (!chatId) return;

  const { up, down } = await readCounters(env, chatId);

  const text = `❤️ Лайки цього чату\n\n👍: ${up}\n👎: ${down}\n\nТисни кнопки нижче.`;
  await tgFetch(env, "sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: keyboard(up, down),
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  });
}

export function likesCanHandleCallback(data?: string) {
  return typeof data === "string" && data.startsWith("likes:");
}

export async function likesOnCallback(env: EnvLike, update: Update) {
  const cb = update?.callback_query;
  const data: string | undefined = cb?.data;
  const msg = cb?.message;
  const chatId: number | undefined = msg?.chat?.id;
  const messageId: number | undefined = msg?.message_id;

  if (!chatId || !messageId || !data) return;

  const { up, down } = await readCounters(env, chatId);

  let nu = up, nd = down;
  if (data === "likes:+1") nu = up + 1;
  if (data === "likes:-1") nd = down + 1;

  await writeCounters(env, chatId, nu, nd);

  // коротка “вспливаюча” нотифікація на кнопці
  await tgFetch(env, "answerCallbackQuery", {
    callback_query_id: cb.id,
    show_alert: false,
    text: data === "likes:+1" ? "Дякую за 👍" : "Прийнято 👎",
  });

  // оновлюємо повідомлення
  const newText = `❤️ Лайки цього чату\n\n👍: ${nu}\n👎: ${nd}\n\nТисни кнопки нижче.`;
  await tgFetch(env, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: newText,
    reply_markup: keyboard(nu, nd),
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  });
}