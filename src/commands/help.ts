// src/commands/help.ts
import { tgSendMessage } from "../utils/telegram";
import { normalizeLang, type Lang } from "../utils/i18n";

export interface Env {
  BOT_TOKEN: string;
}

const HELP_TEXTS: Record<Lang, string> = {
  uk: [
    "Senti — довідка",
    "",
    "Доступні команди:",
    "• /ping — перевірка звʼязку",
    "• /ask <текст> — питання до моделі",
    "• /stats — статистика (демо)",
    "• /menu — головне меню",
    "• /help — цей список",
    "",
    "Діагностика (GET у браузері):",
    "• /diagnostics/ai/provider",
    "• /diagnostics/ai/gemini/models",
    "• /diagnostics/ai/gemini/ping",
    "• /diagnostics/ai/openrouter/models",
    "• /diagnostics/ai/cf-vision",
    "",
    "Порада: якщо відповідь не прийшла — перевір змінні середовища (API-ключі) у воркері.",
  ].join("\n"),

  ru: [
    "Senti — справка",
    "",
    "Доступные команды:",
    "• /ping — проверка связи",
    "• /ask <текст> — вопрос к модели",
    "• /stats — статистика (демо)",
    "• /menu — главное меню",
    "• /help — этот список",
    "",
    "Диагностика (GET в браузере):",
    "• /diagnostics/ai/provider",
    "• /diagnostics/ai/gemini/models",
    "• /diagnostics/ai/gemini/ping",
    "• /diagnostics/ai/openrouter/models",
    "• /diagnostics/ai/cf-vision",
    "",
    "Подсказка: если ответа нет — проверь переменные окружения (API-ключи) в воркере.",
  ].join("\n"),

  de: [
    "Senti — Hilfe",
    "",
    "Verfügbare Befehle:",
    "• /ping — Verbindungstest",
    "• /ask <Text> — Frage an das Modell",
    "• /stats — Statistik (Demo)",
    "• /menu — Hauptmenü",
    "• /help — diese Liste",
    "",
    "Diagnose (GET im Browser):",
    "• /diagnostics/ai/provider",
    "• /diagnostics/ai/gemini/models",
    "• /diagnostics/ai/gemini/ping",
    "• /diagnostics/ai/openrouter/models",
    "• /diagnostics/ai/cf-vision",
    "",
    "Tipp: Wenn keine Antwort kommt – Umgebungsvariablen (API-Keys) im Worker prüfen.",
  ].join("\n"),

  en: [
    "Senti — Help",
    "",
    "Available commands:",
    "• /ping — connectivity check",
    "• /ask <text> — question to the model",
    "• /stats — statistics (demo)",
    "• /menu — main menu",
    "• /help — this list",
    "",
    "Diagnostics (GET in browser):",
    "• /diagnostics/ai/provider",
    "• /diagnostics/ai/gemini/models",
    "• /diagnostics/ai/gemini/ping",
    "• /diagnostics/ai/openrouter/models",
    "• /diagnostics/ai/cf-vision",
    "",
    "Tip: if no reply — verify environment variables (API keys) in the Worker.",
  ].join("\n"),
};

/** Надсилає довідку + кнопку відкриття меню */
export async function sendHelp(env: Env, chatId: number, langCode?: string) {
  const lang = normalizeLang(langCode);
  const text = HELP_TEXTS[lang] ?? HELP_TEXTS.en;
  await tgSendMessage(env as any, chatId, text, {
    reply_markup: {
      inline_keyboard: [[{ text: "🔘 Відкрити меню", callback_data: "menu:open" }]],
    },
  });
}