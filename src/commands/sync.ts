// src/commands/sync.ts
import { setMyCommands, deleteMyCommands, getMyCommands } from "../utils/telegram";
import type { Env } from "../index";

/** Опис команд трьома мовами */
const CMD_TEXT = {
  uk: {
    start: "Запустити бота",
    help:  "Довідка",
    ping:  "Перевірка зв'язку",
    likes: "Керувати вподобайками",
    stats: "Статистика",
    menu:  "Меню",
    ask:   "Запит до ШІ",
  },
  en: {
    start: "Start the bot",
    help:  "Help",
    ping:  "Connectivity check",
    likes: "Chat likes",
    stats: "Statistics (demo)",
    menu:  "Menu",
    ask:   "Ask the AI",
  },
  ru: {
    start: "Запустить бота",
    help:  "Справка",
    ping:  "Проверка связи",
    likes: "Управлять лайками",
    stats: "Статистика",
    menu:  "Меню",
    ask:   "Вопрос к ИИ",
  },
};

/** Повертає список команд для конкретної мови */
export function commandsList(lang: "uk" | "en" | "ru" | undefined = "uk") {
  const t = CMD_TEXT[lang || "uk"];
  return [
    { command: "start", description: t.start },
    { command: "help",  description: t.help  },
    { command: "ping",  description: t.ping  },
    { command: "likes", description: t.likes },
    { command: "stats", description: t.stats },
    { command: "menu",  description: t.menu  },
    { command: "ask",   description: t.ask   },
    // /id не світимо у меню навмисно
  ];
}

const SCOPES = [
  { type: "default" },
  { type: "all_private_chats" },
  { type: "all_group_chats" },
  { type: "all_chat_administrators" },
] as const;

const LANGS = [undefined, "uk", "en", "ru"] as const;

export async function resetAllCommands(env: Env) {
  for (const s of SCOPES) {
    await deleteMyCommands(env as any, s as any, undefined);
    for (const lng of LANGS) {
      await deleteMyCommands(env as any, s as any, lng as any);
    }
  }
  return { ok: true };
}

export async function syncCommands(env: Env) {
  for (const s of SCOPES) {
    // спочатку чистимо, щоб уникнути «хвостів»
    await deleteMyCommands(env as any, s as any, undefined);
    for (const lng of LANGS) {
      const list = commandsList(lng as any);
      await setMyCommands(env as any, list, s as any, lng as any);
    }
  }
  return { ok: true };
}

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
  for (const s of scopes) {
    await deleteMyCommands(env as any, s as any, undefined);
    for (const lng of LANGS) {
      const list = commandsList(lng as any);
      await setMyCommands(env as any, list, s as any, lng as any);
    }
  }
  return { ok: true };
}

/** форс: виставити ПУСТІ команди у всіх глобальних scope/lang */
export async function forceEmptyAllCommands(env: Env) {
  for (const s of SCOPES) {
    await setMyCommands(env as any, [], s as any, undefined);
    for (const lng of LANGS) {
      await setMyCommands(env as any, [], s as any, lng as any);
    }
  }
  return { ok: true };
}

/** 🔎 діагностика для конкретного чату */
export async function snapshotChatCommands(env: Env, chatId: number | string) {
  const out: Record<string, any> = {};
  const scopes = [
    { type: "chat", chat_id: chatId },
    { type: "chat_administrators", chat_id: chatId },
  ];
  for (const s of scopes) {
    const k = `${s.type}:${chatId}`;
    out[k] = {};
    for (const lng of LANGS) {
      const r = await getMyCommands(env as any, s as any, lng as any);
      out[k][lng || "defaultLang"] = r?.result || [];
    }
  }
  return out;
}