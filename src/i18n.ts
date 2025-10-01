// src/i18n.ts

export type Lang = "uk" | "en" | "de" | "ru";

/**
 * Мінімальний детектор мови:
 * 1) пріоритет — language_code з Telegram (uk|en|de|ru*)
 * 2) якщо не задано — грубе визначення по алфавіту
 * 3) дефолт — "uk"
 */
export function detectLang(languageCode?: string | null, sampleText?: string | null): Lang {
  const code = (languageCode || "").toLowerCase();

  if (code.startsWith("uk") || code.startsWith("ua")) return "uk";
  if (code.startsWith("en")) return "en";
  if (code.startsWith("de")) return "de";
  if (code.startsWith("ru")) return "ru";

  const text = sampleText || "";
  const isCyrillic = /[а-яёіїєґ]/i.test(text);
  if (isCyrillic) {
    // українська/російська — без точної ідентифікації, віддамо "uk" за замовчуванням
    return "uk";
  }

  return "en";
}

type Dict = Record<
  Lang,
  {
    start: string;
    helpTitle: string;
    helpCommandsTitle: string;
    helpDiagnosticsTitle: string;
    helpHint: string;
    cmdPing: string;
    cmdAskGemini: string;
    cmdAskOR: string;
    cmdHelp: string;
  }
>;

const dict: Dict = {
  uk: {
    start:
      "Senti — готовий 🛠️\n\nНабери /help, щоб побачити доступні команди.",
    helpTitle: "Senti — довідка",
    helpCommandsTitle: "Доступні команди:",
    helpDiagnosticsTitle: "Діагностика (GET у браузері):",
    helpHint:
      "Порада: якщо відповідь не прийшла — перевір змінні середовища (API-ключі) у воркері.",
    cmdPing: "/ping — перевірка звʼязку",
    cmdAskGemini: "/ask <текст> — питання до Gemini",
    cmdAskOR: "/ask_openrouter <текст> — питання через OpenRouter",
    cmdHelp: "/help — цей список",
  },
  en: {
    start:
      "Senti is ready 🛠️\n\nType /help to see available commands.",
    helpTitle: "Senti — Help",
    helpCommandsTitle: "Available commands:",
    helpDiagnosticsTitle: "Diagnostics (GET in browser):",
    helpHint:
      "Tip: if there is no response — check environment variables (API keys) in the Worker.",
    cmdPing: "/ping — connectivity check",
    cmdAskGemini: "/ask <text> — question to Gemini",
    cmdAskOR: "/ask_openrouter <text> — question via OpenRouter",
    cmdHelp: "/help — this list",
  },
  de: {
    start:
      "Senti ist bereit 🛠️\n\nTippe /help, um verfügbare Befehle zu sehen.",
    helpTitle: "Senti — Hilfe",
    helpCommandsTitle: "Verfügbare Befehle:",
    helpDiagnosticsTitle: "Diagnostik (GET im Browser):",
    helpHint:
      "Tipp: Wenn keine Antwort kommt — prüfe die Umgebungsvariablen (API-Schlüssel) im Worker.",
    cmdPing: "/ping — Verbindungscheck",
    cmdAskGemini: "/ask <Text> — Frage an Gemini",
    cmdAskOR: "/ask_openrouter <Text> — Frage über OpenRouter",
    cmdHelp: "/help — diese Liste",
  },
  ru: {
    start:
      "Senti готов 🛠️\n\nНабери /help, чтобы увидеть доступные команды.",
    helpTitle: "Senti — справка",
    helpCommandsTitle: "Доступные команды:",
    helpDiagnosticsTitle: "Диагностика (GET в браузере):",
    helpHint:
      "Подсказка: если ответ не пришёл — проверь переменные окружения (API-ключи) в воркере.",
    cmdPing: "/ping — проверка связи",
    cmdAskGemini: "/ask <текст> — вопрос к Gemini",
    cmdAskOR: "/ask_openrouter <текст> — вопрос через OpenRouter",
    cmdHelp: "/help — этот список",
  },
};

/**
 * Отримати текст для конкретної мови.
 */
export function i18n(lang: Lang) {
  const l = dict[lang] || dict.uk;
  return l;
}

/**
 * Зручний хелпер з одним викликом:
 *   t({ language_code, text }).helpTitle
 */
export function t(ctx?: { language_code?: string | null; text?: string | null }) {
  const lang = detectLang(ctx?.language_code, ctx?.text);
  return i18n(lang);
}