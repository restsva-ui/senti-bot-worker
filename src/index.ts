// src/index.ts
import { tgSendMessage } from "./utils/telegram";
import { ping as pingCommand } from "./commands/ping";
import { sendHelp } from "./commands/help";
import { handleDiagnostics } from "./diagnostics-ai";
import { normalizeLang, type Lang } from "./utils/i18n";
import { askSmart, quickTemplateReply, type ReplierEnv } from "./services/replier";
import { wikiSetAwait, wikiMaybeHandleFreeText } from "./commands/registry";
import { likesCommand, likesCanHandleCallback, likesOnCallback } from "./commands/likes";
import { statsCommand } from "./commands/stats";
import { menuCommand, menuOnCallback } from "./commands/menu";   // 🆕 меню

export interface Env extends ReplierEnv {
  // Telegram
  BOT_TOKEN: string;
  TELEGRAM_SECRET_TOKEN?: string;
  WEBHOOK_SECRET?: string;

  // Infra
  CF_VISION?: string;
  CLOUDFLARE_API_TOKEN?: string;

  // KV
  LIKES_KV?: KVNamespace;
  DEDUP_KV?: KVNamespace; // антидубль
}

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function getMessageInfo(update: any): { chatId?: number; text?: string; fromLangCode?: string } {
  const msg =
    update?.message ||
    update?.edited_message ||
    update?.channel_post ||
    update?.callback_query?.message ||
    null;

  const chatId: number | undefined = msg?.chat?.id;
  const text: string | undefined =
    update?.message?.text ||
    update?.edited_message?.text ||
    update?.channel_post?.text ||
    update?.callback_query?.message?.text ||
    undefined;

  const fromLangCode: string | undefined =
    update?.message?.from?.language_code ||
    update?.edited_message?.from?.language_code ||
    update?.channel_post?.from?.language_code ||
    update?.callback_query?.from?.language_code ||
    undefined;

  return { chatId, text, fromLangCode };
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "senti-bot-worker", ts: Date.now() });
    }

    const diag = await handleDiagnostics(request, env as any, url);
    if (diag) return diag;

    if (request.method === "POST" && url.pathname === "/webhook") {
      const expected = (env.TELEGRAM_SECRET_TOKEN || env.WEBHOOK_SECRET || "").trim();
      if (expected) {
        const got = (request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "").trim();
        if (got !== expected) return json({ ok: false, error: "invalid secret" }, 403);
      }

      let update: any = null;
      try {
        update = await request.json();
      } catch {
        return json({ ok: false, error: "bad json" }, 400);
      }

      const uid: number | string | undefined = update?.update_id;
      if (uid !== undefined && (await seenUpdateRecently(env, uid, 300))) {
        return json({ ok: true, dedup: true });
      }

      const { chatId, text, fromLangCode } = getMessageInfo(update);

      try {
        // ==== Callback ====
        if (update?.callback_query?.id && chatId) {
          const data = update?.callback_query?.data as string | undefined;

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

          if (trimmed === "/wiki" || trimmed.startsWith("/wiki ")) {
            await wikiSetAwait({ env }, update as any);
            return json({ ok: true, handled: "wiki" });
          }

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
              if (quick) {
                answers.push(quick);
                continue;
              }

              const { text: answer } = await askSmart(env, q, qLang);
              answers.push(answer);
            }

            const response = answers.join("\n— — —\n");
            await tgSendMessage(env as any, chatId, response);
            return json({ ok: true, handled: `ask:${blocks.length}` });
          }

          if (!trimmed.startsWith("/")) {
            const handled = await wikiMaybeHandleFreeText({ env }, update as any);
            if (handled) return json({ ok: true, handled: "wiki:free" });
          }

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
            await tgSendMessage(
              env as any,
              safeChat,
              `Вибач, сталася внутрішня помилка: ${e?.message || String(e)}`
            );
          }
        } catch {}
        return json({ ok: false, error: "internal" }, 500);
      }
    }

    return json({ ok: false, error: "not found" }, 404);
  },
};