import type { Env } from "../config";
import { sendMessage } from "../telegram/api";
import { llmChat } from "../ai/llm";

function extractQuestion(text?: string) {
  return (text || "").replace(/^\/ask(@\S+)?\s*/i, "").trim();
}

export async function cmdAsk(env: Env, chatId: number, fullText?: string, userId?: number) {
  const q = extractQuestion(fullText);
  if (!q) {
    await sendMessage(chatId, "Напиши: /ask ваше питання");
    return;
  }

  // простий ліміт: лише OWNER отримує до 400 токенів
  const owner = env.OWNER_ID ? String(env.OWNER_ID) : "";
  const isOwner = owner && String(userId || "") === owner;
  const maxTokens = isOwner ? 600 : 250;

  try {
    const answer = await llmChat(env, [
      { role: "system", content: "Ти стислий, корисний асистент. Відповідай українською." },
      { role: "user", content: q },
    ], maxTokens);

    await sendMessage(chatId, answer || "Нічого не згенерував :(");
  } catch (e:any) {
    await sendMessage(chatId, `LLM помилка: ${e?.message || e}`);
  }
}