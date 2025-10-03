// src/commands/menu.ts
import { tgSendMessage } from "../utils/telegram";
import type { Env } from "../index";
import { sendHelp } from "./help";

// (залишаємо можливість зберігати префи, але без клавіатур)
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

// ===== Публічні хендлери =====

// /menu – просто текст без клавіатури
export async function menuCommand(env: Env, chatId: number) {
  await tgSendMessage(
    env as any,
    chatId,
    [
      "📍 Головне меню",
      "",
      "Напиши повідомлення, або скористайся командами:",
      "• /ask <текст>",
      "• /ping",
      "• /stats",
      "• /help",
    ].join("\n")
  );
}

// Обробка callback'ів тут формально лишається, але *без* інлайн-кнопок:
// якщо раптом прилетів старий callback — відповімо текстом.
export async function menuOnCallback(env: Env, update: any) {
  const data = update?.callback_query?.data as string | undefined;
  const chatId = update?.callback_query?.message?.chat?.id as number | undefined;
  const userId =
    update?.callback_query?.from?.id ??
    update?.callback_query?.message?.from?.id ??
    update?.message?.from?.id;

  if (!chatId || !data) return;

  // Псевдо-налаштування без клавіатур
  if (data.startsWith("settings:set:")) {
    const parts = data.split(":");
    const field = parts[2];
    const value = parts[3];
    if (field === "lang" && (value === "uk" || value === "en")) {
      await writeSettings(env, userId, { lang: value });
      await tgSendMessage(env as any, chatId, `✅ Мову збережено: ${value}`);
      return;
    }
    if (field === "theme" && (value === "light" || value === "dark")) {
      await writeSettings(env, userId, { theme: value });
      await tgSendMessage(env as any, chatId, `✅ Тему збережено: ${value}`);
      return;
    }
    if (field === "notify" && (value === "on" || value === "off")) {
      await writeSettings(env, userId, { notify: value === "on" });
      await tgSendMessage(env as any, chatId, `✅ Нотифікації: ${value === "on" ? "увімкн." : "вимкн."}`);
      return;
    }
  }

  if (data === "menu:help") {
    await sendHelp(env as any, chatId, "uk" as any);
    return;
  }

  // Дефолт — просто підкажемо користувачу
  await tgSendMessage(env as any, chatId, "Напиши питання або скористайся /help.");
}