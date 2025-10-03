// src/commands/menu.ts
import { tgSendMessage } from "../utils/telegram";
import type { Env } from "../index";
import { sendHelp } from "./help"; // не показуємо в меню, але лишимо для можливих викликів

/** =========================
 *  Типи та KV-хелпери
 *  ========================= */
type Lang = "uk" | "en";

type UserSettings = {
  lang?: Lang;                 // мова інтерфейсу
  theme?: "light" | "dark";    // тема (на майбутнє)
  notify?: boolean;            // нотифікації (на майбутнє)
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

/** =========================
 *  Локалізація (мінімум рядків)
 *  ========================= */
const T = {
  title:        { uk: "📍 Меню",               en: "📍 Menu" },
  settings:     { uk: "⚙️ Налаштування",       en: "⚙️ Settings" },
  settingsTitle:{ uk: "⚙️ Налаштування",       en: "⚙️ Settings" },
  langUk:       { uk: "Мова: Українська",      en: "Language: Ukrainian" },
  langEn:       { uk: "Language: English",     en: "Language: English" },
  themeLight:   { uk: "Тема: Світла",          en: "Theme: Light" },
  themeDark:    { uk: "Тема: Темна",           en: "Theme: Dark" },
  notifyOn:     { uk: "Нотифікації: Увімкн.",  en: "Notifications: On" },
  notifyOff:    { uk: "Нотифікації: Вимкн.",   en: "Notifications: Off" },
  back:         { uk: "⬅️ Назад",              en: "⬅️ Back" },
} as const;

function t<K extends keyof typeof T>(key: K, lang: Lang): string {
  return T[key][lang] ?? (T[key]["en"] as string);
}

/** =========================
 *  Клавіатури
 *  ========================= */
// Головне меню — тільки 1 кнопка «Налаштування»
function mainKeyboard(lang: Lang) {
  return {
    inline_keyboard: [[{ text: t("settings", lang), callback_data: "menu:settings" }]],
  };
}

function settingsKeyboard(s: Required<UserSettings>) {
  const lang = s.lang;
  const mark = (ok: boolean) => (ok ? "✅" : "☑️");
  return {
    inline_keyboard: [
      [
        { text: `${mark(s.lang === "uk")} ${t("langUk", lang)}`, callback_data: "settings:set:lang:uk" },
        { text: `${mark(s.lang === "en")} ${t("langEn", lang)}`, callback_data: "settings:set:lang:en" },
      ],
      [
        { text: `${mark(s.theme === "light")} ${t("themeLight", lang)}`, callback_data: "settings:set:theme:light" },
        { text: `${mark(s.theme === "dark")} ${t("themeDark", lang)}`,   callback_data: "settings:set:theme:dark" },
      ],
      [
        {
          text: `${mark(s.notify)} ${s.notify ? t("notifyOn", lang) : t("notifyOff", lang)}`,
          callback_data: `settings:set:notify:${s.notify ? "off" : "on"}`
        },
      ],
      [{ text: t("back", lang), callback_data: "menu:back" }],
    ],
  };
}

/** =========================
 *  Публічні хендлери
 *  ========================= */
export async function menuCommand(env: Env, chatId: number) {
  // Для /menu показуємо головне мінімалістичне меню у дефолтній мові
  const s = { ...DEFAULT_SETTINGS };
  await tgSendMessage(env as any, chatId, t("title", s.lang), {
    reply_markup: mainKeyboard(s.lang),
  });
}

export async function menuOnCallback(env: Env, update: any) {
  const data = update?.callback_query?.data as string | undefined;
  const chatId = update?.callback_query?.message?.chat?.id as number | undefined;
  const userId =
    update?.callback_query?.from?.id ??
    update?.callback_query?.message?.from?.id ??
    update?.message?.from?.id;

  if (!chatId || !data || !userId) return;

  const s = await readSettings(env, userId);
  const lang = s.lang;

  const showMain = async () =>
    tgSendMessage(env as any, chatId, t("title", lang), { reply_markup: mainKeyboard(lang) });

  const showSettings = async () =>
    tgSendMessage(env as any, chatId, t("settingsTitle", lang), { reply_markup: settingsKeyboard(s) });

  if (data === "menu:settings") {
    await showSettings();
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
      await writeSettings(env, userId, { lang: value as Lang });
    } else if (field === "theme" && (value === "light" || value === "dark")) {
      await writeSettings(env, userId, { theme: value as "light" | "dark" });
    } else if (field === "notify" && (value === "on" || value === "off")) {
      await writeSettings(env, userId, { notify: value === "on" });
    }

    const s2 = await readSettings(env, userId);
    await tgSendMessage(env as any, chatId, t("settingsTitle", s2.lang), {
      reply_markup: settingsKeyboard(s2),
    });
    return;
  }

  // fallback — нічого зайвого не показуємо
  await showMain();
}