// src/commands/help.ts
import { tgSendMessage } from "../utils/telegram";

export interface Env {
  BOT_TOKEN: string;
}

const HELP_MD = [
  "*Senti — довідка*",
  "",
  "Доступні команди:",
  "• `/ping` — перевірка зв’язку",
  "• `/ask <текст>` — питання до Gemini",
  "• `/ask_openrouter <текст>` — питання через OpenRouter",
  "• `/help` — цей список",
  "",
  "Діагностика (GET у браузері):",
  "• `/diagnostics/ai/provider`",
  "• `/diagnostics/ai/gemini/models`",
  "• `/diagnostics/ai/gemini/ping`",
  "• `/diagnostics/ai/openrouter/models`",
  "• `/diagnostics/ai/cf-vision`",
  "",
  "_Порада:_ якщо відповідь не прийшла — перевір змінні середовища (API-ключі) у воркері.",
].join("\n");

export async function sendHelp(env: Env, chatId: number) {
  await tgSendMessage(env as any, chatId, HELP_MD, {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  });
}