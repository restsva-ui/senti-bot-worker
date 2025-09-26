import { sendMessage } from "../telegram/api";
import { CFG } from "../config";

function flag(ok: boolean | undefined) {
  return ok ? "✅" : "❌";
}

export async function diag(chatId: number) {
  const lines = [
    "🧪 Діагностика Senti",
    "",
    `Telegram API base: ${CFG.API_BASE_URL}`,
    `BOT_TOKEN: ${flag(!!CFG.BOT_TOKEN)}`,
    "",
    "🔌 Моделі:",
    `OpenRouter key: ${flag(!!CFG.OPENROUTER_API_KEY)}`,
    `OpenRouter model: ${CFG.OPENROUTER_MODEL ?? "–"}`,
    `OpenRouter vision: ${CFG.OPENROUTER_MODEL_VISION ?? "–"}`,
    "",
    "⚙️ Інше:",
    `CF AI Gateway: ${flag(!!CFG.CF_AI_GATEWAY_BASE)}`,
    `OWNER_ID: ${CFG.OWNER_ID ?? "–"}`,
    `KV STATE: ${flag(!!CFG.STATE)}`,
  ].join("\n");

  await sendMessage(chatId, lines);
}