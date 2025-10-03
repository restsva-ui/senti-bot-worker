// src/commands/help.ts
import { tgSendMessage } from "../utils/telegram";
import type { Lang } from "../utils/i18n";

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
    "• /likes — лайки чату",
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
    "• /ask <текст> — вопрос к Gemini",
    "• /ask_openrouter <текст> — вопрос через OpenRouter",
    "• /likes — лайки чата",
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
    "• /ask <Text> — Frage an Gemini",
    "• /ask_openrouter <Text> — Frage über OpenRouter",
    "• /likes — Chat-Likes",
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
    "Tipp: Wenn keine Antwort kommt – prüfe die Umgebungsvariablen (API-Keys) im Worker.",
  ].join("\n"),

  en: [
    "Senti — Help",
    "",
    "Available commands:",
    "• /ping — connectivity check",
    "• /ask <text> — question to Gemini",
    "• /ask_openrouter <text> — question via OpenRouter",
    "• /likes — chat likes",
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

/** Надсилає довідку + інлайн-кнопки для швидкого відкриття меню/розділів */
export async function sendHelp(env: Env, chatId: number, lang: Lang = "uk") {
  const text = HELP_TEXTS[lang] ?? HELP_TEXTS.en;

  await tgSendMessage(env as any, chatId, text, {
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔘 Відкрити меню", callback_data: "menu:open" }],
        [
          { text: "📖 Вікі", callback_data: "menu:wiki" },
          { text: "👍 Лайки", callback_data: "menu:likes" },
        ],
      ],
    },
  });
}

export default sendHelp;