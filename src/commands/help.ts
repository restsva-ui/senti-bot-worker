// src/commands/help.ts

import { tgSendMessage } from "../utils/telegram";
import { t } from "../i18n";

export interface EnvLike {
  // залишаємо вільний тип, щоб не ламати існуючі імпорти
  [k: string]: any;
}

type TGFrom = { language_code?: string | null };
type TGMessage = { text?: string | null; from?: TGFrom | null } | null | undefined;

const DIAG_ROUTES = [
  "/diagnostics/ai/provider",
  "/diagnostics/ai/gemini/models",
  "/diagnostics/ai/gemini/ping",
  "/diagnostics/ai/openrouter/models",
  "/diagnostics/ai/cf-vision",
];

/**
 * /help — локалізована довідка
 */
export async function help(env: EnvLike, chatId: number, msg?: TGMessage): Promise<void> {
  const loc = t({ language_code: msg?.from?.language_code ?? null, text: msg?.text ?? null });

  const text =
    `*${loc.helpTitle}*\n\n` +
    `${loc.helpCommandsTitle}\n` +
    `• ${loc.cmdPing}\n` +
    `• ${loc.cmdAskGemini}\n` +
    `• ${loc.cmdAskOR}\n` +
    `• ${loc.cmdHelp}\n\n` +
    `${loc.helpDiagnosticsTitle}\n` +
    DIAG_ROUTES.map((r) => `• \`${r}\``).join("\n") +
    `\n\n_${loc.helpHint}_`;

  // Надсилаємо без parse_mode, щоб не змінювати підпис tgSendMessage; якщо в тебе є підтримка — можна передати "Markdown"
  await tgSendMessage(env, chatId, text);
}

/**
 * /start — показує локалізоване вітання + коротку підказку щодо /help
 * За бажанням можна одразу викликати help(), але щоб не «спамити»,
 * лишаємо короткий старт.
 */
export async function start(env: EnvLike, chatId: number, msg?: TGMessage): Promise<void> {
  const loc = t({ language_code: msg?.from?.language_code ?? null, text: msg?.text ?? null });
  const text = `${loc.start}\n\n${loc.helpDiagnosticsTitle}\n` +
    DIAG_ROUTES.map((r) => `• \`${r}\``).join("\n");
  await tgSendMessage(env, chatId, text);
}