import { sendMessage } from "./utils/telegram";
import { cmdHelp, helpText } from "./commands/help";
import { cmdWiki } from "./commands/wiki";
import { cmdPing } from "./commands/ping";
import { cmdStart } from "./commands/start";
import type { Env, TgUpdate } from "./types";

// ----------------------------------------------------
// Допоміжні функції
// ----------------------------------------------------
function isCommand(msg: { text?: string }, cmd: string): boolean {
  const text = msg.text ?? "";
  return text.trim().startsWith(`/${cmd}`);
}

// ----------------------------------------------------
// Основний хендлер
// ----------------------------------------------------
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let update: TgUpdate;
    try {
      update = await req.json();
    } catch (err) {
      console.error("Failed to parse update:", err);
      return new Response("Bad Request", { status: 400 });
    }

    const msg = update.message;
    if (!msg || !msg.text) {
      return new Response("No message", { status: 200 });
    }

    const text = msg.text.trim();
    const chatId = msg.chat.id;

    // Лог команд для відладки
    console.log("[cmd]", JSON.stringify(text));

    try {
      // /start
      if (isCommand(msg, "start")) {
        await cmdStart(env, update);
        return new Response("OK");
      }

      // /ping
      if (isCommand(msg, "ping")) {
        await cmdPing(env, update);
        return new Response("OK");
      }

      // /health
      if (isCommand(msg, "health")) {
        await sendMessage(env, chatId, "ok ✅");
        return new Response("OK");
      }

      // /help
      if (isCommand(msg, "help")) {
        try {
          await cmdHelp(env, update);
        } catch (err) {
          console.error("[help] handler error, fallback to inline:", err);
          await sendMessage(env, chatId, helpText());
        }
        return new Response("OK");
      }

      // /wiki
      if (isCommand(msg, "wiki")) {
        await cmdWiki(env, update);
        return new Response("OK");
      }

      // Якщо команда не відома
      await sendMessage(env, chatId, "Невідома команда. Спробуй /help");
      return new Response("OK");
    } catch (err) {
      console.error("Handler error:", err);
      await sendMessage(env, chatId, "Сталася помилка ⚠️");
      return new Response("OK");
    }
  },
};