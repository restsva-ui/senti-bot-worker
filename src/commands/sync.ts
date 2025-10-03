// src/commands/sync.ts
import { setMyCommands, deleteMyCommands, getMyCommands } from "../utils/telegram";
import type { Env } from "../index";

/** Єдиний канонічний список команд бота (без wiki). */
export function commandsList() {
  return [
    { command: "start", description: "Запустити бота" },
    { command: "help",  description: "Довідка" },
    { command: "ping",  description: "Перевірка зв'язку" },
    { command: "likes", description: "Керувати вподобайками" },
    { command: "stats", description: "Статистика" },
    { command: "menu",  description: "Меню" },
    { command: "ask",   description: "Запит до ШІ" },
  ];
}

const SCOPES = [
  { type: "default" },
  { type: "all_private_chats" },
  { type: "all_group_chats" },
  { type: "all_chat_administrators" },
] as const;

const LANGS = [undefined, "uk", "en", "ru"] as const;

/** Скинути команди в усіх основних scope і мовах. */
export async function resetAllCommands(env: Env) {
  for (const s of SCOPES) {
    await deleteMyCommands(env as any, s as any, undefined);
    for (const lng of LANGS) {
      await deleteMyCommands(env as any, s as any, lng as any);
    }
  }
  return { ok: true };
}

/** Виставити новий список для всіх scope і мов. */
export async function syncCommands(env: Env) {
  const commands = commandsList();

  for (const s of SCOPES) {
    await deleteMyCommands(env as any, s as any, undefined);
    for (const lng of LANGS) {
      await setMyCommands(env as any, commands, s as any, lng as any);
    }
  }
  return { ok: true };
}

/** Для діагностики: показати команди по всіх scope/lang. */
export async function snapshotCommands(env: Env) {
  const out: Record<string, any> = {};
  for (const s of SCOPES) {
    const sKey = s.type;
    out[sKey] = {};
    for (const lng of LANGS) {
      const r = await getMyCommands(env as any, s as any, lng as any);
      out[sKey][lng || "defaultLang"] = r?.result || [];
    }
  }
  return out;
}

/** Опційно: скинути/виставити для конкретного чату. */
export async function resetChatCommands(env: Env, chatId: number | string) {
  const scopes = [
    { type: "chat", chat_id: chatId },
    { type: "chat_administrators", chat_id: chatId },
  ];
  for (const s of scopes) {
    await deleteMyCommands(env as any, s as any, undefined);
    for (const lng of LANGS) {
      await deleteMyCommands(env as any, s as any, lng as any);
    }
  }
  return { ok: true };
}

export async function syncChatCommands(env: Env, chatId: number | string) {
  const scopes = [
    { type: "chat", chat_id: chatId },
    { type: "chat_administrators", chat_id: chatId },
  ];
  const commands = commandsList();
  for (const s of scopes) {
    await deleteMyCommands(env as any, s as any, undefined);
    for (const lng of LANGS) {
      await setMyCommands(env as any, commands, s as any, lng as any);
    }
  }
  return { ok: true };
}