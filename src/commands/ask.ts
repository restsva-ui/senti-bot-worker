import type { Env } from "../config";
import { sendMessage } from "../telegram/api";
import { llmChat } from "../ai/llm";

/** Витягнути питання після команди /ask */
function extractQuestion(text?: string) {
  return (text || "").replace(/^\/ask(@\S+)?\s*/i, "").trim();
}

/** Дуже легка евристика мови за вмістом питання */
function detectLangByText(s: string): "uk" | "ru" | "de" | "en" {
  // українські специфічні літери
  if (/[іІїЇєЄґҐ]/.test(s)) return "uk";
  // будь-яка кирилиця → російська (фолбек)
  if (/[А-Яа-яЁё]/.test(s)) return "ru";
  // німецькі умляути/ß
  if (/[äöüÄÖÜß]/.test(s)) return "de";
  // все інше — англійська
  return "en";
}

/** Згенерувати коротку system-інструкцію під цільову мову */
function systemInstruction(lang: "uk" | "ru" | "de" | "en"): string {
  switch (lang) {
    case "uk":
      return "Ти стислий, корисний асистент. Відповідай українською мовою, чітко і без води.";
    case "ru":
      return "Ты лаконичный, полезный ассистент. Отвечай по-русски, чётко и по делу.";
    case "de":
      return "Du bist ein hilfreicher, prägnanter Assistent. Antworte auf Deutsch, klar und knapp.";
    default:
      return "You are a concise, helpful assistant. Answer in English, clearly and briefly.";
  }
}

export async function cmdAsk(env: Env, chatId: number, fullText?: string, userId?: number) {
  const q = extractQuestion(fullText);
  if (!q) {
    await sendMessage(chatId, "Напиши: /ask ваше питання");
    return;
  }

  // простий ліміт: лише OWNER отримує більше токенів
  const owner = env.OWNER_ID ? String(env.OWNER_ID) : "";
  const isOwner = owner && String(userId || "") === owner;
  const maxTokens = isOwner ? 600 : 250;

  // визначаємо мову за текстом питання
  const lang = detectLangByText(q);
  const sys = systemInstruction(lang);

  try {
    const answer = await llmChat(
      env,
      [
        { role: "system", content: sys },
        { role: "user", content: q },
      ],
      maxTokens,
    );

    await sendMessage(chatId, answer || (lang === "uk"
      ? "Нічого не згенерував :("
      : lang === "ru"
      ? "Ничего не сгенерировал :("
      : lang === "de"
      ? "Keine Antwort generiert :("
      : "No output generated :("));
  } catch (e: any) {
    const msg =
      lang === "uk"
        ? `LLM помилка: ${e?.message || e}`
        : lang === "ru"
        ? `LLM ошибка: ${e?.message || e}`
        : lang === "de"
        ? `LLM-Fehler: ${e?.message || e}`
        : `LLM error: ${e?.message || e}`;
    await sendMessage(chatId, msg);
  }
}