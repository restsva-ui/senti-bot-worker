// src/commands/ask.ts
import { tgSendMessage } from "../utils/telegram";
import { normalizeLang, languageInstruction, type Lang } from "../utils/i18n";
import type { Env } from "../index";

import { geminiAskText } from "../ai/gemini";
import { openrouterAskText } from "../ai/openrouter";

function usageByLang(lang: Lang, which: "gemini" | "openrouter"): string {
  const hint =
    which === "openrouter"
      ? {
          uk: "Приклад: /ask_openrouter Поясни різницю між HTTP і HTTPS.",
          ru: "Пример: /ask_openrouter Объясни разницу между HTTP и HTTPS.",
          de: "Beispiel: /ask_openrouter Erkläre kurz den Unterschied zwischen HTTP und HTTPS.",
          en: "Example: /ask_openrouter Explain the difference between HTTP and HTTPS.",
        }
      : {
          uk: "Приклад: /ask Поясни різницю між HTTP і HTTPS.",
          ru: "Пример: /ask Объясни разницу между HTTP и HTTPS.",
          de: "Beispiel: /ask Erkläre kurz den Unterschied zwischen HTTP und HTTPS.",
          en: "Example: /ask Explain the difference between HTTP and HTTPS.",
        };

  switch (lang) {
    case "uk":
      return `Надішли запит після команди.\n${hint.uk}`;
    case "ru":
      return `Отправь запрос после команды.\n${hint.ru}`;
    case "de":
      return `Sende deine Frage nach dem Befehl.\n${hint.de}`;
    case "en":
    default:
      return `Send your question after the command.\n${hint.en}`;
  }
}

// /ask — через Gemini
export async function handleAsk(env: Env, msg: any): Promise<void> {
  const chatId = msg?.chat?.id;
  const fullText: string = msg?.text ?? "";
  const userText = fullText.replace(/^\/ask(@\S+)?\s*/i, "").trim();
  const tgLangCode: string | undefined = msg?.from?.language_code;

  const lang: Lang = normalizeLang(userText, tgLangCode);
  const system = languageInstruction(lang);

  if (!userText) {
    await tgSendMessage(env as any, chatId, usageByLang(lang, "gemini"));
    return;
  }

  try {
    const answer = await geminiAskText(env as any, system, userText);
    await tgSendMessage(env as any, chatId, answer);
  } catch (e) {
    const err =
      lang === "uk"
        ? "Помилка звернення до Gemini."
        : lang === "ru"
        ? "Ошибка обращения к Gemini."
        : lang === "de"
        ? "Fehler bei der Anfrage an Gemini."
        : "Error while calling Gemini.";
    await tgSendMessage(env as any, chatId, err);
  }
}

// /ask_openrouter — через OpenRouter
export async function handleAskOpenRouter(env: Env, msg: any): Promise<void> {
  const chatId = msg?.chat?.id;
  const fullText: string = msg?.text ?? "";
  const userText = fullText.replace(/^\/ask_openrouter(@\S+)?\s*/i, "").trim();
  const tgLangCode: string | undefined = msg?.from?.language_code;

  const lang: Lang = normalizeLang(userText, tgLangCode);
  const system = languageInstruction(lang);

  if (!userText) {
    await tgSendMessage(env as any, chatId, usageByLang(lang, "openrouter"));
    return;
  }

  try {
    const answer = await openrouterAskText(env as any, system, userText);
    await tgSendMessage(env as any, chatId, answer);
  } catch (e) {
    const err =
      lang === "uk"
        ? "Помилка звернення до OpenRouter."
        : lang === "ru"
        ? "Ошибка обращения к OpenRouter."
        : lang === "de"
        ? "Fehler bei der Anfrage an OpenRouter."
        : "Error while calling OpenRouter.";
    await tgSendMessage(env as any, chatId, err);
  }
}