// src/commands/menu.ts
import { tgSendMessage, tgEditMessageReplyMarkup } from "../utils/telegram";
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
  // використаємо SENTI_CACHE, якщо присутній
  return (env as any).SENTI_CACHE as KVNamespace | undefined;
}
const skey = (userId: number) => `prefs:${userId}`;

/** зчитати налаштування користувача (або дефолт) */
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

/** зберегти налаштування (якщо є KV) */
async function writeSettings(env: Env, userId: number, patch: Partial<UserSettings>): Promise<void> {
  const kv = cache(env);
  if (!kv) return; // тихо ігноруємо, якщо нема KV
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
  const messageId = update?.callback_query?.message?.message_id as number | undefined;
  const chatId = update?.callback_query?.message?.chat?.id as number | undefined;
  const userId =
    update?.callback_query?.from?.id ??
    update?.callback_query?.message?.from?.id ??
    update?.message?.from?.id;

  if (!chatId || !data) return;

  // Допоміжники для оновлення клавіатури під тим же повідомленням
  const safeEditMarkup = async (markup: any) => {
    if (!messageId) {
      await tgSendMessage(env as any, chatId, "📍 Меню:", { reply_markup: markup });
      return;
    }
    try {
      await tgEditMessageReplyMarkup(env as any, chatId, messageId, markup);
    } catch {
      // якщо не вдалось — надішлемо нове повідомлення
      await tgSendMessage(env as any, chatId, "📍 Меню:", { reply_markup: markup });
    }
  };

  // ---- Роутинг по кнопках ----
  if (data === "menu:ask") {
    await tgSendMessage(env as any, chatId, "Введи своє питання з /ask ...");
    return;
  }

  if (data === "menu:wiki") {
    // вмикаємо режим очікування терміну для wiki
    try {
      await wikiSetAwait({ env }, update as any);
      await tgSendMessage(env as any, chatId, "Увімкнено вікі-режим. Напиши термін 👇");
    } catch {
      await tgSendMessage(env as any, chatId, "Увімкнено вікі-режим. Напиши термін 👇");
    }
    return;
  }

  if (data === "menu:likes") {
    // відкриємо одразу модуль лайків
    await likesCommand(env as any, { message: { chat: { id: chatId } } });
    return;
  }

  if (data === "menu:settings") {
    const s = await readSettings(env, userId);
    await tgSendMessage(env as any, chatId, "⚙️ Налаштування:", {
      reply_markup: settingsKeyboard(s),
    });
    return;
  }

  if (data === "menu:help") {
    await sendHelp(env as any, chatId, "uk" as any);
    return;
  }

  if (data === "menu:back") {
    await safeEditMarkup(mainKeyboard());
    return;
  }

  // ---- Зміна налаштувань ----
  if (data.startsWith("settings:set:")) {
    // data прикладу: settings:set:lang:uk | settings:set:theme:dark | settings:set:notify:on
    const parts = data.split(":"); // ["settings","set","<field>","<value>"]
    const field = parts[2];
    const value = parts[3];

    const cur = await readSettings(env, userId);
    if (field === "lang" && (value === "uk" || value === "en")) {
      await writeSettings(env, userId, { lang: value });
    } else if (field === "theme" && (value === "light" || value === "dark")) {
      await writeSettings(env, userId, { theme: value });
    } else if (field === "notify" && (value === "on" || value === "off")) {
      await writeSettings(env, userId, { notify: value === "on" });
    }

    const next = await readSettings(env, userId);
    await safeEditMarkup(settingsKeyboard(next));
    return;
  }

  // Фолбек — покажемо дані
  await tgSendMessage(env as any, chatId, `tap: ${data}`);
}