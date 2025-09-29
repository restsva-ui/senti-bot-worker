// src/commands/start.ts
import type { TgUpdate } from "../types";

type Env = { BOT_TOKEN: string; API_BASE_URL?: string };
type TgCmd = { command: string; description: string };

const MINIMAL_CMDS: TgCmd[] = [
  { command: "help", description: "Довідка" },
  { command: "wiki", description: "Пошук у Вікіпедії" },
];

function apiBase(env: Env) {
  return env.API_BASE_URL || "https://api.telegram.org";
}

async function tgCall<T = any>(
  env: Env,
  method: string,
  payload: Record<string, unknown>
): Promise<T> {
  const r = await fetch(`${apiBase(env)}/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await r.json().catch(() => ({}))) as T;
}

async function deleteCommands(env: Env, scope: Record<string, unknown>) {
  await tgCall(env, "deleteMyCommands", { scope });
}
async function setCommands(env: Env, scope: Record<string, unknown>) {
  await tgCall(env, "setMyCommands", { commands: MINIMAL_CMDS, scope });
}

export const startCommand = {
  name: "start",
  description: "Початкове повідомлення для користувача",
  async execute(env: Env, update: TgUpdate) {
    const chatId = update.message?.chat?.id;
    if (!chatId) return;

    // Вітання
    await tgCall(env, "sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text:
        "👋 Привіт! Я <b>Senti</b> — бот-асистент.\n\n" +
        "Корисне:\n" +
        "• /menu — кнопки команд\n" +
        "• /help — довідка\n" +
        "• /wiki — введи запит у відповідь або одразу так: <code>/wiki  Київ</code>, <code>/wiki  en  Albert Einstein</code>",
    });

    // 1) Почистити попередні списки в глобальних областях
    await deleteCommands(env, { type: "default" }).catch(() => {});
    await deleteCommands(env, { type: "all_private_chats" }).catch(() => {});
    await deleteCommands(env, { type: "all_group_chats" }).catch(() => {});
    await deleteCommands(env, { type: "all_chat_administrators" }).catch(() => {});

    // 2) Поставити мінімальне меню глобально (на майбутні чати)
    await setCommands(env, { type: "default" }).catch(() => {});
    await setCommands(env, { type: "all_private_chats" }).catch(() => {});

    // 3) Головне: ПРИЦІЛЬНО оновити меню саме в цьому чаті (ефект одразу)
    await setCommands(env, { type: "chat", chat_id: chatId }).catch(() => {});
  },
} as const;