// src/commands/ask.ts

import type { Env } from "../index";
import { tgSendMessage } from "../utils/telegram";
import { normalizeLang, languageInstruction, type Lang } from "../utils/i18n";

// Ці імпорти покладені на існуючі обгортки у твоєму репозиторії.
// Імена збережені такими, як зазвичай у подібних структурах.
import { geminiAskText } from "../ai/gemini";
import { openrouterAskText } from "../ai/openrouter";

/**
 * Формуємо користувацький запит з інструкцією про мову відповіді.
 * Це безпечно і абсолютно сумісно з будь-якою LLM: інструкція зверху → запит нижче.
 */
function buildPromptWithLang(text: string, lang: Lang): string {
  const instruction = languageInstruction(lang);
  // Інструкція системного рівня + розділювач — мінімально інвазивно.
  return `${instruction}\n\nUser question:\n${text}`;
}

/**
 * /ask — через Gemini
 */
export async function ask(
  env: Env,
  chatId: number,
  userText: string,
  tgLanguageCode?: string,
): Promise<void> {
  const lang = normalizeLang(userText, tgLanguageCode);
  const prompt = buildPromptWithLang(userText, lang);

  try {
    const answer = await geminiAskText(env, prompt);
    await tgSendMessage(env as any, chatId, answer || "(empty)");
  } catch (e: any) {
    await tgSendMessage(
      env as any,
      chatId,
      `Помилка /ask: ${e?.message || String(e)}`,
    );
  }
}

/**
 * /ask_openrouter — через OpenRouter
 */
export async function askOpenrouter(
  env: Env,
  chatId: number,
  userText: string,
  tgLanguageCode?: string,
): Promise<void> {
  const lang = normalizeLang(userText, tgLanguageCode);
  const prompt = buildPromptWithLang(userText, lang);

  try {
    const answer = await openrouterAskText(env, prompt);
    await tgSendMessage(env as any, chatId, answer || "(empty)");
  } catch (e: any) {
    await tgSendMessage(
      env as any,
      chatId,
      `Помилка /ask_openrouter: ${e?.message || String(e)}`,
    );
  }
}