// src/index.ts
import { tgSendMessage } from "./utils/telegram";
import { ping as pingCommand } from "./commands/ping";
import { handleDiagnostics } from "./diagnostics";
import { handleDiagnosticsAI } from "./diagnostics-ai"; // ⬅️ нове

export interface Env {
  // Telegram
  BOT_TOKEN: string;
  TELEGRAM_SECRET_TOKEN?: string;
  WEBHOOK_SECRET?: string;

  // Cloudflare AI Vision
  CF_VISION: string;
  CLOUDFLARE_API_TOKEN: string;

  // AI провайдери (опційно, для /ai/text)
  GEMINI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
}

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 0) healthcheck
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "senti-bot-worker", ts: Date.now() });
    }

    // 1) AI-діагностика (новий окремий модуль /ai/*)
    //    /ai/text, /ai/models, /ai/vision ...
    if (url.pathname.startsWith("/ai")) {
      const r = await handleDiagnosticsAI(request, env);
      if (r) return r;
    }

    // 2) інші діагностичні ендпоїнти (ping, token-verify, vision-test тощо)
    const diag = await handleDiagnostics(request, env, url);
    if (diag) return diag;

    // 3) Telegram webhook
    if (request.method === "POST" && url.pathname === "/webhook") {
      // Перевірка секрету (fallback на WEBHOOK_SECRET)
      const expected = env.TELEGRAM_SECRET_TOKEN || env.WEBHOOK_SECRET || "";
      if (expected) {
        const got = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
        if (got !== expected) return json({ ok: false, error: "invalid secret" }, 403);
      }

      // Зчитуємо апдейт
      let update: any = null;
      try {
        update = await request.json();
      } catch {
        return json({ ok: false, error: "bad json" }, 400);
      }

      try {
        // /ping
        const msg = update?.message;
        const text: string | undefined = msg?.text;
        const chatId = msg?.chat?.id;
        if (text === "/ping" && chatId) {
          await pingCommand(env as any, chatId);
          return json({ ok: true, handled: "ping" });
        }

        // callback_query
        const cb = update?.callback_query;
        if (cb?.id && cb?.message?.chat?.id) {
          await tgSendMessage(env as any, cb.message.chat.id, `tap: ${cb.data ?? ""}`);
          return json({ ok: true, handled: "callback" });
        }

        // no-op
        return json({ ok: true, noop: true });
      } catch (e: any) {
        console.error("Webhook error:", e?.message || e);
        return json({ ok: false, error: "internal" }, 500);
      }
    }

    // 4) 404
    return json({ ok: false, error: "not found" }, 404);
  },
};