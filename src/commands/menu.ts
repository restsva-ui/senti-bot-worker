// src/commands/menu.ts
import { tgSendMessage } from "../utils/telegram";
import type { Env } from "../index";
import { wikiSetAwait } from "./registry";
import { likesCommand } from "./likes";
import { sendHelp } from "./help";

// ===== Типи та KV-хелпери =====
type UserSettings = {
  lang?: "uk" | "en";
  theme?: "light" | "dark";
  notify?: boolean;
};

const DEFAULT_SETTINGS: Required<UserSettings> = {
  lang: "uk",
  theme: "dark",
  notify: true,
};

function cache(env: Env): KVNamespace | undefined {
  return (env as any).SENTI_CACHE as KVNamespace | undefined;
}
const skey = (userId: number) => `prefs:${userId}`;

async function readSettings(env: Env, userId: number): Promise<Required<UserSettings>> {
  const kv = cache(env);
  if (!kv) return { ...DEFAULT_SETTINGS };
  try {
    const raw = await kv.get(skey(userId), "json");
    return { ...DEFAULT_SETTINGS, ...(raw || {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function writeSettings(env: Env, userId: number, patch: Partial<UserSettings>): Promise<void> {
  const kv = cache(env);
  if (!kv) return;
  const cur = await readSettings(env, userId);
  const next = { ...cur, ...patch };
  await kv.put(skey(userId), JSON.stringify(next));
}

// ===== Розмітка клавіатур =====
function mainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🧠 Задати питання", callback_data: "menu:ask" },
        { text: "📖 Вікі", callback_data: "menu:wiki" },
      ],
      [
        { text: "👍 Лайки", callback_data: "menu:likes" },
        { text: "⚙️ Налаштування", callback_data: "menu:settings" },
      ],
      [{ text: "ℹ️ Допомога", callback_data: "menu:help" }],
    ],
  };
}

function settingsKeyboard(s: Required<UserSettings>) {
  const mark = (ok: boolean) => (ok ? "✅" : "☑️");
  return {
    inline_keyboard: [
      [
        {
          text: `${mark(s.lang === "uk")} Мова: Українська`,
          callback_data: "settings:set:lang:uk",
        },
        {
          text: `${mark(s.lang === "en")} Language: English`,
          callback_data: "settings:set:lang:en",
        },
      ],
      [
        {
          text: `${mark(s.theme === "light")} Тема: Світла`,
          callback_data: "settings:set:theme:light",
        },
        {
          text: `${mark(s.theme === "dark")} Тема: Темна`,
          callback_data: "settings:set:theme:dark",
        },
      ],
      [
        {
          text: `${mark(s.notify)} Нотифікації: ${s.notify ? "Увімкн." : "Вимкн."}`,
          callback_data: `settings:set:notify:${s.notify ? "off" : "on"}`,
        },
      ],
      [{ text: "⬅️ Назад", callback_data: "menu:back" }],
    ],
  };
}

// ===== Публічні хендлери =====
export async function menuCommand(env: Env, chatId: number) {
  await tgSendMessage(env as any, chatId, "📍 Головне меню:", {
    reply_markup: mainKeyboard(),
  });
}

export async function menuOnCallback(env: Env, update: any) {
  const data = update?.callback_query?.data as string | undefined;
  const chatId = update?.callback_query?.message?.chat?.id as number | undefined;
  const userId =
    update?.callback_query?.from?.id ??
    update?.callback_query?.message?.from?.id ??
    update?.message?.from?.id;

  if (!chatId || !data) return;

  // Замість редагування старого повідомлення — шлемо нове
  const showMain = async () =>
    tgSendMessage(env as any, chatId, "📍 Головне меню:", { reply_markup: mainKeyboard() });
  const showSettings = async () => {
    const s = await readSettings(env, userId);
    await tgSendMessage(env as any, chatId, "⚙️ Налаштування:", {
      reply_markup: settingsKeyboard(s),
    });
  };

  if (data === "menu:ask") {
    await tgSendMessage(env as any, chatId, "Введи своє питання з /ask ...");
    return;
  }
  if (data === "menu:wiki") {
    try {
      await wikiSetAwait({ env }, update as any);
    } catch {}
    await tgSendMessage(env as any, chatId, "Увімкнено вікі-режим. Напиши термін 👇");
    return;
  }
  if (data === "menu:likes") {
    await likesCommand(env as any, { message: { chat: { id: chatId } } });
    return;
  }
  if (data === "menu:settings") {
    await showSettings();
    return;
  }
  if (data === "menu:help") {
    await sendHelp(env as any, chatId, "uk" as any);
    return;
  }
  if (data === "menu:back") {
    await showMain();
    return;
  }

  // ---- Зміна налаштувань ----
  if (data.startsWith("settings:set:")) {
    const parts = data.split(":"); // ["settings","set","<field>","<value>"]
    const field = parts[2];
    const value = parts[3];

    if (field === "lang" && (value === "uk" || value === "en")) {
      await writeSettings(env, userId, { lang: value });
    } else if (field === "theme" && (value === "light" || value === "dark")) {
      await writeSettings(env, userId, { theme: value });
    } else if (field === "notify" && (value === "on" || value === "off")) {
      await writeSettings(env, userId, { notify: value === "on" });
    }
    await showSettings();
    return;
  }

  await tgSendMessage(env as any, chatId, `tap: ${data}`);
}