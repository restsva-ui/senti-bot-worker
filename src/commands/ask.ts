// src/commands/ask.ts
import { tgSendMessage } from "../utils/telegram";
import { normalizeLang, type Lang } from "../utils/i18n";
import { askSmart, quickTemplateReply, type ReplierEnv } from "../services/replier";

type Ctx = {
  env: ReplierEnv;
  chatId: number | string;
  text: string;
  tgLanguageCode?: string | null;
};

function splitAskLines(raw: string): string[] {
  const lines = (raw || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  // беремо тільки /ask-рядки та прибираємо префікс-команди
  return lines
    .filter(l => /^\/ask\b/i.test(l))
    .map(l => l.replace(/^\/ask(?:@[A-Za-z0-9_]+)?\s*/i, "").trim())
    .filter(Boolean);
}

export async function handleAsk(ctx: Ctx) {
  const { env, chatId, text, tgLanguageCode } = ctx;

  const items = splitAskLines(text);
  if (!items.length) {
    await tgSendMessage(env as any, chatId, "Немає запитів після /ask.");
    return;
  }

  for (const item of items) {
    // 1) Визначаємо мову *для цього конкретного рядка*
    const lang: Lang = normalizeLang(item, tgLanguageCode || undefined);

    // 2) Спробуємо миттєву коротку відповідь (так/ні/привіт/ок тощо)
    const quick = quickTemplateReply(lang, item);
    if (quick) {
      await tgSendMessage(env as any, chatId, quick);
      continue;
    }

    // 3) Звертаємось до LLM
    try {
      const { text: answer } = await askSmart(env, item, lang);
      await tgSendMessage(env as any, chatId, answer);
    } catch (e: any) {
      await tgSendMessage(
        env as any,
        chatId,
        lang === "uk"
          ? "Вибач, щось пішло не так. Спробуй ще раз."
          : lang === "ru"
          ? "Извини, что-то пошло не так. Попробуй ещё раз."
          : lang === "de"
          ? "Entschuldigung, etwas ist schiefgelaufen. Bitte versuche es erneut."
          : "Sorry, something went wrong. Please try again."
      );
    }
  }
}