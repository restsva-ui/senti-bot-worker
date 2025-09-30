// src/commands/ping.ts
import { tgSendMessage } from "../utils/telegram";

/**
 * Named export, якого чекає registry:
 *   import pingNamed, { ping as pingExport } from "./ping";
 * Ми даємо named "ping" і default (той самий) для сумісності.
 */
export async function ping(env: any, chatId: number) {
  await tgSendMessage(env, chatId, "pong ✅");
}

// Default export (ідентичний), щоб задовольнити import pingNamed, default
export default ping;