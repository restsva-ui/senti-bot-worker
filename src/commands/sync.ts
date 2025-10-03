// src/commands/sync.ts
import { setMyCommands, deleteMyCommands } from "../utils/telegram";
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

/** Скинути команди в усіх основних scope і мовах. */
export async function resetAllCommands(env: Env) {
  const scopes = [
    { type: "default" },
    { type: "all_private_chats" },
    { type: "all_group_chats" },
    { type: "all_chat_administrators" },
  ] as const;

  const langs = [undefined, "uk", "en"] as const;

  for (const s of scopes) {
    await deleteMyCommands(env as any, s as any, undefined);
    for (const lng of langs) {
      await deleteMyCommands(env as any, s as any, lng as any);
    }
  }
  return { ok: true };
}

/** Виставити новий список для всіх scope і мов. */
export async function syncCommands(env: Env) {
  const commands = commandsList();

  const scopes = [
    { type: "default" },
    { type: "all_private_chats" },
    { type: "all_group_chats" },
    { type: "all_chat_administrators" },
  ] as const;

  const langs = [undefined, "uk", "en"] as const;

  for (const s of scopes) {
    // Спочатку видалимо, щоб прибрати залишки старих команд
    await deleteMyCommands(env as any, s as any, undefined);
    for (const lng of langs) {
      await setMyCommands(env as any, commands, s as any, lng as any);
    }
  }
  return { ok: true };
}