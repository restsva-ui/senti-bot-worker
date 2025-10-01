// src/index.ts
import { tgSendMessage } from "./utils/telegram";
import { ping as pingCommand } from "./commands/ping";
import { sendHelp } from "./commands/help";
import { handleDiagnostics } from "./diagnostics-ai";
import { normalizeLang, type Lang } from "./utils/i18n";

import { geminiAskText } from "./ai/gemini";
import { openrouterAskText } from "./ai/openrouter";

export interface Env {
  // Telegram
  BOT_TOKEN: string;
  TELEGRAM_SECRET_TOKEN?: string;
  WEBHOOK_SECRET?: string;

  // AI keys
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;

  // CF flags (можуть бути, не використовуємо тут напряму)
  CF_VISION?: string;
  CLOUDFLARE_API_TOKEN?: string;
}

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Акуратно вирізаємо аргумент після команди */
function extractArg(text: string, command: string): string {
  // приклади: "/ask Привіт", "/ask@YourBot Привіт"
  const noBot = text.replace(new RegExp(`^\\/${command}(?:@[\\w_]+)?\\s*`, "i"), "");
  return noBot.trim();
}

/** Отримуємо raw текст повідомлення з update */
function getIncomingText(update: any): string {
  return (
    update?.message?.text ??
    update?.edited_message?.text ??
    update?.callback_query?.message?.text ??
    ""
  );
}

/** language_code з Telegram (для bias у детекторі) */
function getTelegramLangCode(update: any): string | undefined {
  return (
    update?.message?.from?.language_code ||
    update?.edited_message?.from?.language_code ||
    update?.callback_query?.from?.language_code ||
    undefined
  );
}

/** Визначаємо бажану мову відповіді на основі контенту + Telegram language_code */
function decideLang(rawText: string, update: any): Lang {
  const tgCode = getTelegramLangCode(update);
  // normalizeLang вміє ігнорувати префікси команд і враховувати tgCode
  return normalizeLang(rawText || "", tgCode);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // healthcheck
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: