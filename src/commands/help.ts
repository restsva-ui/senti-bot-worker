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
    "• /ask <текст> — питання до моделі (Cloudflare Workers AI)",
    "• /likes — лайки чату",
    "• /stats — статистика (демо)",
    "• /menu — мінімальне меню",
    "• /help — цей список",
    "",
    "Діагностика (відкривай у браузері):",
    "• /diagnostics — компактна сторінка з кнопками",
    "• /diagnostics/ai/provider — зведення по ключах/провайдерах",
    "• /diagnostics/ai/cf-vision — список моделей Cloudflare AI (API)",
    "• /diagnostics/ai/cf-ping — швидкий ping через Workers AI binding",
    "• /diagnostics/ai/gemini/models — список моделей Gemini",
    "• /diagnostics/ai/gemini/ping — ping Gemini",
    "• /diagnostics/ai/openrouter/models — список моделей OpenRouter",
    "• /diagnostics/photos — як працює фото-флоу",
    "",
    "Порада: якщо відповідь не прийшла — перевір змінні середовища (API-ключі) у Worker.",
  ].join("\n"),

  ru: [
    "Senti — справка",
    "",
    "Доступные команды:",
    "• /ping — проверка связи",
    "• /ask <текст> — вопрос к модели (Cloudflare Workers AI)",
    "• /likes — лайки чата",
    "• /stats — статистика (демо)",
    "• /menu — минимальное меню",
    "• /help — этот список",
    "",
    "Диагностика (открывай в браузере):",
    "• /diagnostics — компактная страница с кнопками",
    "• /diagnostics/ai/provider — сводка по ключам/провайдерам",
    "• /diagnostics/ai/cf-vision — список моделей Cloudflare AI (API)",
    "• /diagnostics/ai/cf-ping — быстрый ping через Workers AI binding",
    "• /diagnostics/ai/gemini/models — список моделей Gemini",
    "• /diagnostics/ai/gemini/ping — ping Gemini",
    "• /diagnostics/ai/openrouter/models — список моделей OpenRouter",
    "• /diagnostics/photos — как работает фото-поток",
    "",
    "Подсказка: если ответа нет — проверь переменные окружения (API-ключи) в Worker.",
  ].join("\n"),

  de: [
    "Senti — Hilfe",
    "",
    "Verfügbare Befehle:",
    "• /ping — Verbindungstest",
    "• /ask <Text> — Frage an das Modell (Cloudflare Workers AI)",
    "• /likes — Chat-Likes",
    "• /stats — Statistik (Demo)",
    "• /menu — minimalistisches Menü",
    "• /help — diese Liste",
    "",
    "Diagnose (im Browser öffnen):",
    "• /diagnostics — kompakte Seite mit Buttons",
    "• /diagnostics/ai/provider — Übersicht über Keys/Provider",
    "• /diagnostics/ai/cf-vision — Cloudflare-AI-Modelle (API)",
    "• /diagnostics/ai/cf-ping — schneller Ping via Workers-AI-Binding",
    "• /diagnostics/ai/gemini/models — Gemini-Modelle",
    "• /diagnostics/ai/gemini/ping — Ping Gemini",
    "• /diagnostics/ai/openrouter/models — OpenRouter-Modelle",
    "• /diagnostics/photos — Ablauf Fotoanalyse",
    "",
    "Tipp: Wenn keine Antwort kommt – Umgebungsvariablen (API-Keys) im Worker prüfen.",
  ].join("\n"),

  en: [
    "Senti — Help",
    "",
    "Available commands:",
    "• /ping — connectivity check",
    "• /ask <text> — question to the model (Cloudflare Workers AI)",
    "• /likes — chat likes",
    "• /stats — statistics (demo)",
    "• /menu — minimalist menu",
    "• /help — this list",
    "",
    "Diagnostics (open in browser):",
    "• /diagnostics — compact page with buttons",
    "• /diagnostics/ai/provider — keys/providers summary",
    "• /diagnostics/ai/cf-vision — Cloudflare AI models (API)",
    "• /diagnostics/ai/cf-ping — quick ping via Workers AI binding",
    "• /diagnostics/ai/gemini/models — Gemini models",
    "• /diagnostics/ai/gemini/ping — ping Gemini",
    "• /diagnostics/ai/openrouter/models — OpenRouter models",
    "• /diagnostics/photos — how the photo flow works",
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