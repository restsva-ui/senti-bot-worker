// src/index.ts
import { tgSendMessage } from "./utils/telegram";
import { ping as pingCommand } from "./commands/ping";
import { sendHelp } from "./commands/help";
import { handleDiagnostics } from "./diagnostics-ai";
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

function getMessageInfo(update: any): {
  chatId?: number; text?: string; fromLangCode?: string; fromId?: number;
} {
  const msg =
    update?.message || update?.edited_message || update?.channel_post || update?.callback_query?.message || null;

  const chatId: number | undefined = msg?.chat?.id;

  const text: string | undefined =
    update?.message?.text ??
    update?.edited_message?.text ??
    update?.channel_post?.text ??
    update?.callback_query?.message?.text ??
    undefined;

  const fromLangCode: string | undefined =
    update?.message?.from?.language_code ??
    update?.edited_message?.from?.language_code ??
    update?.channel_post?.from?.language_code ??
    update?.callback_query?.from?.language_code ??
    undefined;

  const fromId: number | undefined =
    update?.message?.from?.id ??
    update?.edited_message?.from?.id ??
    update?.channel_post?.from?.id ??
    update?.callback_query?.from?.id ??
    undefined;

  return { chatId, text, fromLangCode, fromId };
}

function extractAskBlocks(source: string): string[] {
  const t = (source || "").trim();
  const re = /\/ask(?:@\w+)?\s*/gi;
  const idxs: number[] = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(t))) idxs.push(m.index);
  if (idxs.length === 0) return [];

  const blocks: string[] = [];
  for (let i = 0; i < idxs.length; i++) {
    const start = idxs[i] + (t.slice(idxs[i]).match(/^\/ask(?:@\w+)?\s*/i)?.[0].length || 0);
    const end = i + 1 < idxs.length ? idxs[i + 1] : t.length;
    const chunk = t.slice(start, end).trim();
    if (chunk) blocks.push(chunk);
  }
  return blocks;
}

async function seenUpdateRecently(env: Env, updateId: number | string, ttlSec = 300): Promise<boolean> {
  if (!env.DEDUP_KV) return false;
  const key = `upd:${updateId}`;
  const existed = await env.DEDUP_KV.get(key);
  if (existed) return true;
  await env.DEDUP_KV.put(key, "1", { expirationTtl: ttlSec });
  return false;
}

async function readJsonSafe(req: Request, maxBytes = 1024 * 1024) {
  const ct = req.headers.get("content-type") || "";
  if (!/application\/json/i.test(ct)) throw new Error("bad content-type");
  const ab = await req.arrayBuffer();
  if (ab.byteLength > maxBytes) throw new Error("payload too large");
  const text = new TextDecoder().decode(ab);
  return JSON.parse(text);
}

/* ------------ worker ------------ */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health
    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
      return json({ ok: true, service: "senti-bot-worker", ts: Date.now() });
    }

    // Діагностика лише для не-/webhook, щоб не зачіпати body
    if (url.pathname !== "/webhook") {
      const diag = await handleDiagnostics(request, env as any, url);
      if (diag) return diag;
    }

    // Guard для службових роутів
    const guardOK = () => (env.WEBHOOK_SECRET || "") === (url.searchParams.get("secret") || "");

    // --- Службовий echo для діагностики параметрів ---
    if (request.method === "GET" && url.pathname === "/echo") {
      if (!guardOK()) return json({ ok: false, error: "forbidden" }, 403);
      const chatIdStr = url.searchParams.get("chat_id");
      return json({ ok: true, chatIdStr, asNumber: chatIdStr ? Number(chatIdStr) : null });
    }

    // ---- Командні сервіси (глобальні) ----
    if (request.method === "GET" && url.pathname === "/reset-commands") {
      if (!guardOK()) return json({ ok: false, error: "forbidden" }, 403);
      try {
        const res = await resetAllCommands(env as any);
        return json({ ok: true, ...res });
      } catch (e: any) {
        return json({ ok: false, error: e?.message || String(e) }, 500);
      }
    }

    if (request.method === "GET" && url.pathname === "/sync-commands") {
      if (!guardOK()) return json({ ok: false, error: "forbidden" }, 403);
      try {
        const res = await syncCommands(env as any);
        return json({ ok: true, ...res, commands: commandsList() });
      } catch (e: any) {
        return json({ ok: false, error: e?.message || String(e) }, 500);
      }
    }

    if (request.method === "GET" && url.pathname === "/force-empty-commands") {
      if (!guardOK()) return json({ ok: false, error: "forbidden" }, 403);
      try {
        const res = await forceEmptyAllCommands(env as any);
        return json({ ok: true, ...res, emptied: true });
      } catch (e: any) {
        return json({ ok: false, error: e?.message || String(e) }, 500);
      }
    }

    if (request.method === "GET" && url.pathname === "/debug-commands") {
      if (!guardOK()) return json({ ok: false, error: "forbidden" }, 403);
      try {
        const all = await snapshotCommands(env as any);
        return json({ ok: true, snapshot: all });
      } catch (e: any) {
        return json({ ok: false, error: e?.message || String(e) }, 500);
      }
    }

    // ---- Командні сервіси (конкретний чат) ----
    if (request.method === "GET" && url.pathname === "/debug-commands-chat") {
      if (!guardOK()) return json({ ok: false, error: "forbidden" }, 403);
      const chatIdStr = url.searchParams.get("chat_id");
      if (!chatIdStr) return json({ ok: false, error: "chat_id required" }, 400);
      const chatId = Number(chatIdStr);
      if (Number.isNaN(chatId)) return json({ ok: false, error: "chat_id must be number" }, 400);
      try {
        const snap = await snapshotChatCommands(env as any, chatId);
        return json({ ok: true, snapshot: snap });
      } catch (e: any) {
        return json({ ok: false, error: e?.message || String(e) }, 500);
      }
    }

    if (request.method === "GET" && url.pathname === "/reset-commands-chat") {
      if (!guardOK()) return json({ ok: false, error: "forbidden" }, 403);
      const chatIdStr = url.searchParams.get("chat_id");
      if (!chatIdStr) return json({ ok: false, error: "chat_id required" }, 400);
      const chatId = Number(chatIdStr);
      if (Number.isNaN(chatId)) return json({ ok: false, error: "chat_id must be number" }, 400);
      try {
        const res = await resetChatCommands(env as any, chatId);
        return json({ ok: true, ...res, chatId });
      } catch (e: any) {
        return json({ ok: false, error: e?.message || String(e) }, 500);
      }
    }

    if (request.method === "GET" && url.pathname === "/sync-commands-chat") {
      if (!guardOK()) return json({ ok: false, error: "forbidden" }, 403);
      const chatIdStr = url.searchParams.get("chat_id");
      if (!chatIdStr) return json({ ok: false, error: "chat_id required" }, 400);
      const chatId = Number(chatIdStr);
      if (Number.isNaN(chatId)) return json({ ok: false, error: "chat_id must be number" }, 400);
      try {
        const res = await syncChatCommands(env as any, chatId);
        return json({ ok: true, ...res, chatId, commands: commandsList() });
      } catch (e: any) {
        return json({ ok: false, error: e?.message || String(e) }, 500);
      }
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
        update = await readJsonSafe(request);
      } catch (e: any) {
        return json({ ok: false, error: e?.message || "bad json" }, 400);
      }

      const uid: number | string | undefined = update?.update_id;
      if (uid !== undefined && (await seenUpdateRecently(env, uid, 300))) {
        return json({ ok: true, dedup: true });
      }

      const { chatId, text, fromLangCode, fromId } = getMessageInfo(update);

      try {
        // /id
        if (typeof text === "string" && chatId && /^\/id(?:@\w+)?$/i.test(text.trim())) {
          await idCommand(env as any, chatId, fromId);
          return json({ ok: true, handled: "id" });
        }

        // Callback
        if (update?.callback_query?.id && chatId) {
          const data: string | undefined = update?.callback_query?.data ?? undefined;

          if (likesCanHandleCallback(data)) {
            await likesOnCallback(env as any, update as any);
            return json({ ok: true, handled: "likes:callback" });
          }

          if (data?.startsWith("menu:") || data?.startsWith("settings:")) {
            await menuOnCallback(env as any, update as any);
            return json({ ok: true, handled: "menu:callback" });
          }

          await tgSendMessage(env as any, chatId, `tap: ${data ?? ""}`);
          return json({ ok: true, handled: "callback:echo" });
        }

        // Text / Commands
        if (typeof text === "string" && chatId) {
          const trimmed = text.trim();

          if (/^\/start(?:@\w+)?$/i.test(trimmed) || /^\/help(?:@\w+)?$/i.test(trimmed)) {
            const langForHelp: Lang = normalizeLang(trimmed, fromLangCode);
            await sendHelp(env as any, chatId, langForHelp);
            return json({ ok: true, handled: "help" });
          }

          if (/^\/ping(?:@\w+)?$/i.test(trimmed)) {
            await pingCommand(env as any, chatId);
            return json({ ok: true, handled: "ping" });
          }

          if (/^\/likes(?:@\w+)?$/i.test(trimmed)) {
            await likesCommand(env as any, { message: { chat: { id: chatId } } });
            return json({ ok: true, handled: "likes" });
          }

          if (/^\/stats(?:@\w+)?$/i.test(trimmed)) {
            await statsCommand(env as any, { message: { chat: { id: chatId } } });
            return json({ ok: true, handled: "stats" });
          }

          if (/^\/menu(?:@\w+)?$/i.test(trimmed)) {
            await menuCommand(env as any, chatId);
            return json({ ok: true, handled: "menu" });
          }

          // /ask (може бути кілька разів у одному повідомленні)
          if (/\/ask(?:@\w+)?\b/i.test(trimmed)) {
            const blocks = extractAskBlocks(trimmed);
            if (blocks.length === 0) {
              await tgSendMessage(env as any, chatId, "Будь ласка, додай питання після команди.");
              return json({ ok: true, handled: "ask:empty" });
            }

            const answers: string[] = [];
            for (const q of blocks) {
              const qLang: Lang = normalizeLang(q, fromLangCode);

              const quick = quickTemplateReply(qLang, q);
              if (quick) answers.push(quick);
              else {
                const { text: answer } = await askSmart(env, q, qLang);
                answers.push(answer);
              }
            }

            await tgSendMessage(env as any, chatId, answers.join("\n— — —\n"));
            return json({ ok: true, handled: `ask:${blocks.length}` });
          }

          // fallback → один /ask
          if (trimmed.length > 0) {
            const msgLang: Lang = normalizeLang(trimmed, fromLangCode);

            const quick = quickTemplateReply(msgLang, trimmed);
            if (quick) {
              await tgSendMessage(env as any, chatId, quick);
              return json({ ok: true, handled: "template:plain" });
            }

            const { text: answer } = await askSmart(env, trimmed, msgLang);
            await tgSendMessage(env as any, chatId, answer);
            return json({ ok: true, handled: "ask:fallback" });
          }
        }

        return json({ ok: true, noop: true });
      } catch (e: any) {
        try {
          const { chatId: safeChat } = getMessageInfo(update);
          if (safeChat) {
            await tgSendMessage(env as any, safeChat, `Вибач, сталася внутрішня помилка: ${e?.message || String(e)}`);
          }
        } catch {}
        return json({ ok: false, error: "internal" }, 500);
      }
    }

    return json({ ok: false, error: "not found" }, 404);
  },
};