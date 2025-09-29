// src/index.ts
import type { TgUpdate } from "./types";
import { sendMessage } from "./utils/telegram";
import { COMMANDS } from "./commands/registry";
import { wikiMaybeHandleFreeText } from "./commands/wiki";

type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
  OWNER_ID?: string;
  LIKES_KV?: KVNamespace;
};

async function handleUpdate(update: TgUpdate, env: Env) {
  const msg = update.message ?? update.edited_message;
  if (!msg) return;

  // === 1) Якщо команда ===
  const ent = msg.entities?.[0];
  const isCommand = ent && ent.type === "bot_command" && ent.offset === 0;
  if (isCommand) {
    const m = msg.text?.match(/^\/(\w+)(?:@[\w_]+)?/);
    const cmd = (m?.[1] || "").toLowerCase();

    const fn = (COMMANDS as any)[cmd];
    if (typeof fn === "function") {
      try {
        await fn(update, env);
        return;
      } catch (e) {
        console.warn("cmd error", cmd, e);
        await sendMessage(env, msg.chat.id, "❌ Помилка у виконанні команди.");
        return;
      }
    } else {
      console.warn("Unknown command:", cmd);
      return;
    }
  }

  // === 2) Якщо не команда — дати шанс Wiki обробити вільний текст ===
  try {
    const handled = await wikiMaybeHandleFreeText(update, env);
    if (handled) return;
  } catch (e) {
    console.warn("wiki free-text error", e);
  }

  // === 3) Ігноруємо все інше ===
  return;
}

// Worker entrypoint
export default {
  async fetch(req: Request, env: Env) {
    if (req.method === "POST" && new URL(req.url).pathname === "/webhook") {
      const secret = req.headers.get("x-telegram-bot-api-secret-token");
      if (secret && secret !== "senti1984") {
        return new Response("Forbidden", { status: 403 });
      }

      const update: TgUpdate = await req.json();
      console.info("update:", JSON.stringify(update));
      try {
        await handleUpdate(update, env);
      } catch (err) {
        console.error("handleUpdate error", err);
      }
      return new Response("OK");
    }

    return new Response("Senti bot worker");
  },
};