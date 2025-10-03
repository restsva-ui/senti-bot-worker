import { tgSendMessage } from "./utils/telegram";
import { ping as pingCommand } from "./commands/ping";
import { sendHelp } from "./commands/help";
import { normalizeLang, type Lang } from "./utils/i18n";
import { askSmart, quickTemplateReply, type ReplierEnv } from "./services/replier";
import { likesCommand, likesCanHandleCallback, likesOnCallback } from "./commands/likes";
import { statsCommand } from "./commands/stats";
import { menuCommand, menuOnCallback } from "./commands/menu";
import {
  syncCommands, commandsList, resetAllCommands, snapshotCommands,
  resetChatCommands, syncChatCommands, forceEmptyAllCommands, snapshotChatCommands
} from "./commands/sync";
import { idCommand } from "./commands/id";
import { handleDiagnostics } from "./diagnostics-ai";

export interface Env extends ReplierEnv {
  BOT_TOKEN: string;
  WEBHOOK_SECRET?: string;
  CF_VISION?: string;
  CLOUDFLARE_API_TOKEN?: string;
  LIKES_KV?: KVNamespace;
  DEDUP_KV?: KVNamespace;
  SENTI_CACHE?: KVNamespace;
}

/* ------------ helpers ------------ */
function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function readJsonSafe(req: Request, maxBytes = 1024 * 1024) {
  const ct = req.headers.get("content-type") || "";
  if (!/application\/json/i.test(ct)) throw new Error("bad content-type");
  const ab = await req.arrayBuffer();
  if (ab.byteLength > maxBytes) throw new Error("payload too large");
  const text = new TextDecoder().decode(ab);
  return JSON.parse(text);
}

function getMessageInfo(update: any): { chatId?: number; text?: string; fromLangCode?: string; fromId?: number } {
  const msg = update?.message || update?.edited_message || update?.channel_post || update?.callback_query?.message || null;

  return {
    chatId: msg?.chat?.id,
    text: update?.message?.text ??
      update?.edited_message?.text ??
      update?.channel_post?.text ??
      update?.callback_query?.message?.text,
    fromLangCode: update?.message?.from?.language_code ??
      update?.edited_message?.from?.language_code ??
      update?.channel_post?.from?.language_code ??
      update?.callback_query?.from?.language_code,
    fromId: update?.message?.from?.id ??
      update?.edited_message?.from?.id ??
      update?.channel_post?.from?.id ??
      update?.callback_query?.from?.id,
  };
}

/* ------------ worker ------------ */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json({ ok: true, service: "senti-bot-worker", ts: Date.now() });
    }

    // Діагностика — лише GET (не чіпає body)
    if (request.method === "GET" && url.pathname !== "/webhook") {
      const diag = await handleDiagnostics(request, env as any, url);
      if (diag) return diag;
    }

    // ---- Webhook ----
    if (url.pathname === "/webhook") {
      if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

      const expected = (env.WEBHOOK_SECRET || "").trim();
      if (expected) {
        const got = (request.headers.get("x-telegram-bot-api-secret-token") || "").trim();
        if (got !== expected) return json({ ok: false, error: "invalid secret" }, 403);
      }

      let update: any;
      try {
        update = await readJsonSafe(request); // читаємо body тільки тут
      } catch (e: any) {
        return json({ ok: false, error: e?.message || "bad json" }, 400);
      }

      const { chatId, text } = getMessageInfo(update);

      // приклад: /id
      if (text && /^\/id/.test(text) && chatId) {
        await idCommand(env as any, chatId, update?.message?.from?.id);
        return json({ ok: true, handled: "id" });
      }

      // інші команди... (ping/help/likes/stats/menu/ask)

      return json({ ok: true, noop: true });
    }

    return json({ ok: false, error: "not found" }, 404);
  }
};