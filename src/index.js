// src/index.js
import { drivePing, driveList, saveUrlToDrive, appendToChecklist, getAccessToken } from "./lib/drive.js";
import { TG } from "./lib/tg.js";
import { getUserTokens, putUserTokens, userListFiles, userSaveUrl } from "./lib/userDrive.js";
import { logHeartbeat, logDeploy } from "./lib/audit.js";

// NEW: винесені модулі
import { oauthRoutes } from "./routes/oauth.js";
import { adminRoutes, handleAdminCommand } from "./routes/admin.js";
import { handleUserCommand, tryAutoSaveMedia, mainKeyboard, BTN_DRIVE, BTN_SENTI, BTN_ADMIN } from "./routes/user.js";
import { RAG } from "./lib/rag.js";

const ADMIN = (env, userId) => String(userId) === String(env.TELEGRAM_ADMIN_ID);

function html(s){ return new Response(s, {headers:{ "content-type":"text/html; charset=utf-8" }}) }
function json(o, status=200){ return new Response(JSON.stringify(o,null,2), {status, headers:{ "content-type":"application/json" }}) }

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    try {
      // ---- Health ----
      if (p === "/") return html("Senti Worker Active");
      if (p === "/health") return json({ ok:true, service: env.SERVICE_HOST });

      // ---- Telegram helpers ----
      if (p === "/tg/get-webhook") {
        const r = await TG.getWebhook(env.BOT_TOKEN);
        return new Response(await r.text(), {headers:{'content-type':'application/json'}});
      }
      if (p === "/tg/set-webhook") {
        const target = `https://${env.SERVICE_HOST}/webhook`;
        const r = await TG.setWebhook(env.BOT_TOKEN, target, env.TG_WEBHOOK_SECRET);
        return new Response(await r.text(), {headers:{'content-type':'application/json'}});
      }
      if (p === "/tg/del-webhook") {
        const r = await TG.deleteWebhook?.(env.BOT_TOKEN) || await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/deleteWebhook`);
        return new Response(await r.text(), {headers:{'content-type':'application/json'}});
      }

      // ---- Admin helper routes (команди/чеклист/пінг/CI) ----
      const adminHandled = await adminRoutes(req, env, url);
      if (adminHandled) return adminHandled;

      // ---- OAuth routes ----
      const oauthHandled = await oauthRoutes(req, env, url, { putUserTokens });
      if (oauthHandled) return oauthHandled;

      // ---- Telegram webhook ----
      if (p === "/webhook" && req.method !== "POST") {
        return json({ ok:true, note:"webhook alive (GET)" });
      }

      if (p === "/webhook" && req.method === "POST") {
        const sec = req.headers.get("x-telegram-bot-api-secret-token");
        if (env.TG_WEBHOOK_SECRET && sec !== env.TG_WEBHOOK_SECRET) {
          console.log("Webhook: wrong secret", sec);
          return json({ ok:false, error:"unauthorized" }, 401);
        }

        // Приймаємо апдейт
        let update;
        try {
          update = await req.json();
          console.log("TG update:", JSON.stringify(update).slice(0, 2000));
        } catch {
          return json({ ok:false }, 400);
        }

        const msg = update.message || update.edited_message || update.channel_post || update.callback_query?.message;
        const textRaw = update.message?.text || update.edited_message?.text || update.callback_query?.data || "";
        if (!msg) return json({ok:true});

        const chatId = msg.chat.id;
        const userId = msg.from?.id;
        const text = (textRaw || "").trim();

        const safe = async (fn) => {
          try { await fn(); }
          catch (e) {
            console.log("Handler error:", e);
            try { await TG.text(chatId, `❌ Помилка: ${String(e)}`, { token: env.BOT_TOKEN }); } catch {}
          }
        };

        // --- /start: показати компактну клаву (Google Drive / Senti [+ Admin для власника]) ---
        if (text === "/start") {
          await safe(async () => {
            const isAdmin = ADMIN(env, userId);
            await TG.text(
              chatId,
              "Привіт! Я Senti 🤖",
              { token: env.BOT_TOKEN, reply_markup: mainKeyboard(isAdmin) }
            );
          });
          return json({ok:true});
        }

        // --- ADMIN-команди (/admin, /admin_*, /ask, /summarize) ---
        const isAdmin = ADMIN(env, userId);
        if (text === "/admin" || text.startsWith("/admin_") || text.startsWith("/ask") || text.startsWith("/summarize") || text === BTN_ADMIN) {
          await safe(async () => {
            await handleAdminCommand({ env, chatId, userId, text, msg, isAdmin, TG, getAccessToken, driveList, appendToChecklist, logDeploy, RAG });
          });
          return json({ok:true});
        }

        // --- Кнопки/команди користувача (Google Drive / Senti + user-команди) ---
        const handledUser = await handleUserCommand({
          env, msg, text, chatId, userId,
          TG, getUserTokens, userListFiles, userSaveUrl
        });
        if (handledUser) return json({ok:true});

        // --- Якщо режим диска ON — пробуємо автозбереження будь-яких вкладень ---
        const autoSaved = await tryAutoSaveMedia({ env, msg, chatId, userId, TG, userSaveUrl });
        if (autoSaved) return json({ ok:true });

        // Дефолт
        await safe(async () => {
          await TG.text(chatId, "Готовий 👋", { token: env.BOT_TOKEN, reply_markup: mainKeyboard(isAdmin) });
        });
        return json({ok:true});
      }

      // ---- 404 ----
      return json({ ok:false, error:"Not found" }, 404);
    } catch (e) {
      console.log("Top-level error:", e);
      return json({ ok:false, error:String(e) }, 500);
    }
  },

  // ---- CRON (heartbeat кожні 15 хв) + легкий RAG-індекс ----
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try { await logHeartbeat(env); } catch (e) { console.log("heartbeat error", e); }
      try {
        const token = await getAccessToken(env);
        if (token) {
          const listFn = async () => {
            const files = await driveList(env, token);
            return (files.files||[]).map(f=>({id:f.id, name:f.name, mimeType:f.mimeType||""}));
          };
          const readFn = async (id, n) => {
            const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            const buf = new Uint8Array(await r.arrayBuffer());
            return new TextDecoder("utf-8").decode(buf.slice(0, n));
          };
          await RAG.ingest(env, listFn, readFn);
        }
      } catch (e) { console.log("RAG ingest (cron) error", e); }
    })());
  }
};