// src/commands/help.ts

import { tgSendMessage } from "../utils/telegram";

/** ===== Локалізація (вбудовано, без зовнішніх залежностей) ===== */

type Lang = "uk" | "en" | "de" | "ru";

function detectLang(languageCode?: string | null, sampleText?: string | null): Lang {
  const code = (languageCode || "").toLowerCase();
  if (code.startsWith("uk") || code.startsWith("ua")) return "uk";
  if (code.startsWith("en")) return "en";
  if (code.startsWith("de")) return "de";
  if (code.startsWith("ru")) return "ru";

  const text = sampleText || "";
  const isCyrillic = /[а-яёіїєґ]/i.test(text);
  return isCyrillic ? "uk" : "en";
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
    start: "Senti — готовий 🛠️\n\nНабери /help, щоб побачити доступні команди.",
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
    start: "Senti is ready 🛠️\n\nType /help to see available commands.",
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
    start: "Senti ist bereit 🛠️\n\nTippe /help, um verfügbare Befehle zu sehen.",
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
    start: "Senti готов 🛠️\n\nНабери /help, чтобы увидеть доступные команды.",
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

function t(language_code?: string | null, text?: string | null) {
  const lang = detectLang(language_code, text);
  return dict[lang] || dict.uk;
}

/** ===== Команда /help та /start ===== */

export interface EnvLike {
  [k: string]: any;
}

type TGFrom = { language_code?: string | null } | null | undefined;
type TGMessage = { text?: string | null; from?: TGFrom } | null | undefined;

const DIAG_ROUTES = [
  "/diagnostics/ai/provider",
  "/diagnostics/ai/gemini/models",
  "/diagnostics/ai/gemini/ping",
  "/diagnostics/ai/openrouter/models",
  "/diagnostics/ai/cf-vision",
];

/** Основна реалізація help */
export async function help(env: EnvLike, chatId: number, msg?: TGMessage): Promise<void> {
  const loc = t(msg?.from?.language_code, msg?.text);

  const text =
    `*${loc.helpTitle}*\n\n` +
    `${loc.helpCommandsTitle}\n` +
    `• ${loc.cmdPing}\n` +
    `• ${loc.cmdAskGemini}\n` +
    `• ${loc.cmdAskOR}\n` +
    `• ${loc.cmdHelp}\n\n` +
    `${loc.helpDiagnosticsTitle}\n` +
    DIAG_ROUTES.map((r) => `• \`${r}\``).join("\n") +
    `\n\n_${loc.helpHint}_`;

  await tgSendMessage(env, chatId, text);
}

/** Сумісний псевдонім, який очікує твій існуючий index.ts */
export async function sendHelp(env: EnvLike, chatId: number, msg?: TGMessage): Promise<void> {
  return help(env, chatId, msg);
}

/** Основна реалізація start */
export async function start(env: EnvLike, chatId: number, msg?: TGMessage): Promise<void> {
  const loc = t(msg?.from?.language_code, msg?.text);

  const text =
    `${loc.start}\n\n` +
    `${loc.helpDiagnosticsTitle}\n` +
    DIAG_ROUTES.map((r) => `• \`${r}\``).join("\n");

  await tgSendMessage(env, chatId, text);
}

/** Сумісний псевдонім, якщо десь імпортується sendStart */
export async function sendStart(env: EnvLike, chatId: number, msg?: TGMessage): Promise<void> {
  return start(env, chatId, msg);
}