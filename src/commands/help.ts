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
    "• /ask <текст> — питання до Gemini",
    "• /ask_openrouter <текст> — питання через OpenRouter",
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
    "• /ask <текст> — вопрос к Gemini",
    "• /ask_openrouter <текст> — вопрос через OpenRouter",
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
    "• /ask <Text> — Frage an Gemini",
    "• /ask_openrouter <Text> — Frage über OpenRouter",
    "• /help — diese Liste",
    "",
    "Diagnose (GET im Browser):",
    "• /diagnostics/ai/provider",
    "• /diagnostics/ai/gemini/models",
    "• /diagnostics/ai/gemini/ping",
    "• /diagnostics/ai/openrouter/models",
    "• /diagnostics/ai/cf-vision",
    "",
    "Tipp: Wenn keine Antwort kommt – prüfe die Umgebungsvariablen (API-Keys) im Worker.",
  ].join("\n"),

  en: [
    "Senti — Help",
    "",
    "Available commands:",
    "• /ping — connectivity check",
    "• /ask <text> — question to Gemini",
    "• /ask_openrouter <text> — question via OpenRouter",
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

/** Надсилає довідку з урахуванням мови користувача */
export async function sendHelp(env: Env, chatId: number, langCode?: string) {
  const lang = normalizeLang(langCode);
  const text = HELP_TEXTS[lang] ?? HELP_TEXTS.en;
  await tgSendMessage(env as any, chatId, text);
}