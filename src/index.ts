import { tgSendMessage } from "./utils/telegram";
import { ping as pingCommand } from "./commands/ping";
import { sendHelp } from "./commands/help";
import { normalizeLang, type Lang } from "./utils/i18n";
import { quickTemplateReply, type ReplierEnv } from "./services/replier";
import { likesCommand, likesCanHandleCallback, likesOnCallback } from "./commands/likes";
import { statsCommand } from "./commands/stats";
import { menuCommand, menuOnCallback } from "./commands/menu";
import { idCommand } from "./commands/id";

import {
  syncCommands, commandsList, resetAllCommands, snapshotCommands,
  resetChatCommands, syncChatCommands, forceEmptyAllCommands, snapshotChatCommands
} from "./commands/sync";
import { handleDiagnostics } from "./diagnostics-ai";

// фото-модулі
import { handlePhoto } from "./features/photos/handler.ts";
import { processPhotoWithGemini } from "./features/vision.ts";

// ⬇️ Workers AI binding (Cloudflare)
import { Ai } from "@cloudflare/ai";

/* ======================== Env ======================== */
export interface Env extends ReplierEnv {
  BOT_TOKEN: string;
  WEBHOOK_SECRET?: string;
  TELEGRAM_SECRET_TOKEN?: string;   // сумісність
  CF_VISION?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CF_ACCOUNT_ID?: string;

  LIKES_KV?: KVNamespace;
  DEDUP_KV?: KVNamespace;
  SENTI_CACHE?: KVNamespace;

  // ⬇️ новий binding для Workers AI
  AI: Ai;
}

/* ======================== helpers ======================== */
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

function getMessageInfo(update: any): {
  chatId?: number; text?: string; fromLangCode?: string; fromId?: number;
} {
  const msg =
    update?.message ||
    update?.edited_message ||
    update?.channel_post ||
    update?.callback_query?.message ||
    null;

  return {
    chatId: msg?.chat?.id,
    text:
      update?.message?.text ??
      update?.edited_message?.text ??
      update?.channel_post?.text ??
      update?.callback_query?.message?.text,
    fromLangCode:
      update?.message?.from?.language_code ??
      update?.edited_message?.from?.language_code ??
      update?.channel_post?.from?.language_code ??
      update?.callback_query?.from?.language_code,
    fromId:
      update?.message?.from?.id ??
      update?.edited_message?.from?.id ??
      update?.channel_post?.from?.id ??
      update?.callback_query?.from?.id,
  };
}

async function seenUpdateRecently(env: Env, updateId: number | string, ttlSec = 300): Promise<boolean> {
  if (!env.DEDUP_KV) return false;
  const key = `upd:${updateId}`;
  const existed = await env.DEDUP_KV.get(key);
  if (existed) return true;
  await env.DEDUP_KV.put(key, "1", { expirationTtl: ttlSec });
  return false;
}

function readExpectedSecret(env: Env): string | null {
  const a = (env.WEBHOOK_SECRET || "").trim();
  if (a) return a;
  const b = (env.TELEGRAM_SECRET_TOKEN || "").trim();
  return b || null;
}

/* ======================== worker ======================== */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health
    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
      return json({ ok: true, service: "senti-bot-worker", ts: Date.now() });
    }

    // 🔬 Cloudflare Workers AI — простий ping через binding
    if (request.method === "GET" && url.pathname === "/diagnostics/ai/cf-ping") {
      try {
        const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
          messages: [{ role: "user", content: "Say 'pong' and nothing else." }],
          max_tokens: 16,
        });
        return json({ ok: true, provider: "cloudflare-ai", status: 200, result });
      } catch (e: any) {
        return json(
          { ok: false, provider: "cloudflare-ai", status: 500, error: e?.message || String(e) },
          500
        );
      }
    }

    // 🛡️ Diagnostics (тільки GET і не /webhook)
    if (request.method === "GET" && url.pathname !== "/webhook") {
      const diag = await handleDiagnostics(request, env as any, url);
      if (diag) return diag;
    }

    // Webhook
    if (url.pathname === "/webhook") {
      if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

      const expected = readExpectedSecret(env);
      if (expected) {
        const got =
          (request.headers.get("x-telegram-bot-api-secret-token") ||
            request.headers.get("X-Telegram-Bot-Api-Secret-Token") ||
            "")!.trim();
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
      if (!chatId) return json({ ok: true, noop: true });

      try {
        /* ---------- 1) Фото ---------- */
        if (update?.message?.photo?.length) {
          await handlePhoto(update, env, chatId);
          return json({ ok: true, handled: "photo" });
        }

        /* ---------- 2) Callback-кнопки ---------- */
        if (update?.callback_query?.id) {
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

        /* ---------- 3) Текст / Команди ---------- */
        if (typeof text === "string") {
          const trimmed = text.trim();

          // /id
          if (/^\/id(?:@\w+)?$/i.test(trimmed)) {
            await idCommand(env as any, chatId, fromId);
            return json({ ok: true, handled: "id" });
          }

          // /start | /help
          if (/^\/start(?:@\w+)?$/i.test(trimmed) || /^\/help(?:@\w+)?$/i.test(trimmed)) {
            const langForHelp: Lang = normalizeLang(trimmed, fromLangCode);
            await sendHelp(env as any, chatId, langForHelp);
            return json({ ok: true, handled: "help" });
          }

          // /ping
          if (/^\/ping(?:@\w+)?$/i.test(trimmed)) {
            await pingCommand(env as any, chatId);
            return json({ ok: true, handled: "ping" });
          }

          // /likes
          if (/^\/likes(?:@\w+)?$/i.test(trimmed)) {
            await likesCommand(env as any, { message: { chat: { id: chatId } } });
            return json({ ok: true, handled: "likes" });
          }

          // /stats
          if (/^\/stats(?:@\w+)?$/i.test(trimmed)) {
            await statsCommand(env as any, { message: { chat: { id: chatId } } });
            return json({ ok: true, handled: "stats" });
          }

          // /menu
          if (/^\/menu(?:@\w+)?$/i.test(trimmed)) {
            await menuCommand(env as any, chatId);
            return json({ ok: true, handled: "menu" });
          }

          // 🔹 НОВЕ: /ask <запит> — відповідь через Cloudflare Workers AI
          const askMatch = trimmed.match(/^\/ask(?:@\w+)?\s+([\s\S]+)$/i);
          if (askMatch) {
            const prompt = askMatch[1].trim();
            if (!prompt) {
              await tgSendMessage(env as any, chatId, "Синтаксис: /ask твій_запит");
              return json({ ok: true, handled: "ask:usage" });
            }
            try {
              const result: any = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
                messages: [
                  { role: "system", content: "Be concise and helpful." },
                  { role: "user", content: prompt },
                ],
                max_tokens: 512,
              });
              const out =
                (typeof result?.response === "string" && result.response) ||
                (typeof result?.output_text === "string" && result.output_text) ||
                JSON.stringify(result);
              await tgSendMessage(env as any, chatId, out);
              return json({ ok: true, handled: "ask:cf", usage: result?.usage });
            } catch (err: any) {
              await tgSendMessage(env as any, chatId, `CF-AI помилка: ${err?.message || String(err)}`);
              return json({ ok: false, handled: "ask:error" });
            }
          }

          // 🖼️ Якщо було фото — vision сам дістане його з KV
          if (env.SENTI_CACHE) {
            const result = await processPhotoWithGemini(env as any, chatId, trimmed);
            const out = typeof result === "string" ? result : (result?.text ?? "");
            if (out) {
              await tgSendMessage(env as any, chatId, out);
              return json({ ok: true, handled: "photo:ask" });
            }
          }

          // Швидкі шаблони
          const msgLang: Lang = normalizeLang(trimmed, fromLangCode);
          const quick = quickTemplateReply(msgLang, trimmed);
          if (quick) {
            await tgSendMessage(env as any, chatId, quick);
            return json({ ok: true, handled: "template:plain" });
          }

          // Фолбек — підказка про /ask
          await tgSendMessage(env as any, chatId, "💡 Спробуй /ask питання — відповім через Cloudflare AI.");
          return json({ ok: true, handled: "ask:fallback" });
        }

        return json({ ok: true, noop: true });
      } catch (e: any) {
        try { await tgSendMessage(env as any, chatId!, `⚠️ Помилка: ${e?.message || String(e)}`); } catch {}
        return json({ ok: false, error: "internal" }, 500);
      }
    }

    return json({ ok: false, error: "not found" }, 404);
  },
};