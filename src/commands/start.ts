// src/commands/start.ts
import type { TgUpdate } from "../types";

type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
};

type TgCmd = { command: string; description: string };

function apiBase(env: Env) {
  return env.API_BASE_URL || "https://api.telegram.org";
}

async function tgCall<T = any>(
  env: Env,
  method: string,
  payload: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${apiBase(env)}/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("tgCall error", method, res.status, t);
  }
  return res.json().catch(() => ({} as T));
}

/** Залишаємо лише 2 команди у меню */
const MINIMAL_CMDS: TgCmd[] = [
  { command: "help", description: "Довідка" },
  { command: "wiki", description: "Пошук у Вікіпедії" },
];

/** Оновлюємо меню команд у потрібній області видимості */
async function setCommandsForScope(env: Env, scope: Record<string, unknown>) {
  await tgCall(env, "setMyCommands", {
    commands: MINIMAL_CMDS,
    scope,
    language_code: "", // усі мови
  });
}

/** На всякий випадок чистимо інші області */
async function deleteCommandsForScope(env: Env, scope: Record<string, unknown>) {
  await tgCall(env, "deleteMyCommands", { scope });
}

async function configureMinimalMenu(env: Env) {
  // основні області, де Telegram показує меню
  const defaultScope = { type: "default" };
  const privateScope = { type: "all_private_chats" };
  const groupsScope = { type: "all_group_chats" };
  const adminsScope = { type: "all_chat_administrators" };

  // спочатку прибираємо будь-які старі списки
  await Promise.all([
    deleteCommandsForScope(env, defaultScope),
    deleteCommandsForScope(env, privateScope),
    deleteCommandsForScope(env, groupsScope),
    deleteCommandsForScope(env, adminsScope),
  ]).catch(() => {});

  // далі ставимо мінімальний список там, де треба
  await Promise.all([
    setCommandsForScope(env, defaultScope),
    setCommandsForScope(env, privateScope),
  ]);
}

export const startCommand = {
  name: "start",
  description: "Початкове повідомлення для користувача",
  async execute(env: Env, update: TgUpdate) {
    const chatId = update.message?.chat?.id;
    if (!chatId) return;

    // 1) Вітання
    const text =
      "👋 Привіт! Я <b>Senti</b> — бот-асистент.\n\n" +
      "Корисне:\n" +
      "• /menu — кнопки команд\n" +
      "• /help — довідка\n" +
      "• /wiki — введи запит у відповідь або одразу так: <code>/wiki  Київ</code>, <code>/wiki  en  Albert Einstein</code>";
    await tgCall(env, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    });

    // 2) Ставимо мінімальне меню (help + wiki)
    await configureMinimalMenu(env).catch((e) =>
      console.warn("configureMinimalMenu failed", e)
    );
  },
} as const;