// src/index.js
import { TG } from "./lib/tg.js";

// user Drive OAuth area
import { getUserTokens, putUserTokens, userListFiles, userSaveUrl } from "./lib/userDrive.js";

// KV checklist + audit
import { readChecklist, appendChecklist, checklistHtml } from "./lib/kvChecklist.js";
import { logHeartbeat, logDeploy } from "./lib/audit.js";

// ---------------- small utils ----------------
const ADMIN = (env, userId) => String(userId) === String(env.TELEGRAM_ADMIN_ID);

function html(s){ return new Response(s, {headers:{ "content-type":"text/html; charset=utf-8" }}) }
function json(o, status=200){ return new Response(JSON.stringify(o,null,2), {status, headers:{ "content-type":"application/json" }}) }

// ---------------- Drive-mode state (user area) ----------------
const DRIVE_MODE_KEY = (uid) => `drive_mode:${uid}`;
function ensureState(env) {
  if (!env.STATE_KV) throw new Error("STATE_KV binding missing");
  return env.STATE_KV;
}
async function setDriveMode(env, userId, on) {
  const kv = ensureState(env);
  await kv.put(DRIVE_MODE_KEY(userId), on ? "1" : "0", { expirationTtl: 3600 });
}
async function getDriveMode(env, userId) {
  const kv = ensureState(env);
  const v = await kv.get(DRIVE_MODE_KEY(userId));
  return v === "1";
}

// ---------------- Helpers: detect & save media ----------------
function pickPhoto(msg){
  const arr = msg.photo;
  if (!Array.isArray(arr) || !arr.length) return null;
  const ph = arr[arr.length - 1];
  return { type:"photo", file_id: ph.file_id, name: `photo_${ph.file_unique_id}.jpg` };
}
function detectAttachment(msg){
  if (!msg) return null;
  if (msg.document) {
    const d = msg.document;
    return { type:"document", file_id: d.file_id, name: d.file_name || `document_${d.file_unique_id}` };
  }
  if (msg.video) {
    const v = msg.video;
    return { type:"video", file_id: v.file_id, name: v.file_name || `video_${v.file_unique_id}.mp4` };
  }
  if (msg.audio) {
    const a = msg.audio;
    return { type:"audio", file_id: a.file_id, name: a.file_name || `audio_${a.file_unique_id}.mp3` };
  }
  if (msg.voice) {
    const v = msg.voice;
    return { type:"voice", file_id: v.file_id, name: `voice_${v.file_unique_id}.ogg` };
  }
  if (msg.video_note) {
    const v = msg.video_note;
    return { type:"video_note", file_id: v.file_id, name: `videonote_${v.file_unique_id}.mp4` };
  }
  const ph = pickPhoto(msg);
  if (ph) return ph;
  return null;
}
async function tgFileUrl(env, file_id){
  const d = await TG.api(env.BOT_TOKEN, "getFile", { file_id });
  const path = d?.result?.file_path;
  if (!path) throw new Error("getFile: file_path missing");
  return `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${path}`;
}
async function handleIncomingMedia(env, chatId, userId, msg){
  const att = detectAttachment(msg);
  if (!att) return false;

  const ut = await getUserTokens(env, userId);
  if (!ut?.refresh_token) {
    await TG.text(chatId, "Щоб зберігати у свій Google Drive — спочатку натисни «Google Drive» і дозволь доступ.", { token: env.BOT_TOKEN });
    return true;
  }

  const url = await tgFileUrl(env, att.file_id);
  const saved = await userSaveUrl(env, userId, url, att.name);
  await TG.text(chatId, `✅ Збережено на твоєму диску: ${saved.name}`, { token: env.BOT_TOKEN });
  return true;
}

// ---------------- Reply Keyboards ----------------
const BTN_DRIVE = "Google Drive";
const BTN_SENTI  = "Senti";
const BTN_ADMIN  = "Admin";
const BTN_CHECK  = "Checklist";

function mainKeyboard(isAdmin=false){
  const rows = [
    [{ text: BTN_DRIVE }, { text: BTN_SENTI }],
  ];
  if (isAdmin) rows.push([{ text: BTN_ADMIN }, { text: BTN_CHECK }]);
  return { keyboard: rows, resize_keyboard: true, one_time_keyboard: false };
}
function inlineOpenDrive(){
  return { inline_keyboard: [[{ text: "Відкрити Диск", url: "https://drive.google.com/drive/my-drive" }]] };
}

// ---------------- Commands ----------------
async function installCommandsMinimal(env){
  await TG.setCommands(env.BOT_TOKEN, { type:"default" }, []); // чисте меню
  if (!env.TELEGRAM_ADMIN_ID) throw new Error("TELEGRAM_ADMIN_ID not set");
  await TG.setCommands(env.BOT_TOKEN, { type:"chat", chat_id: Number(env.TELEGRAM_ADMIN_ID) }, [
    { command: "admin", description: "Адмін-меню" },
    { command: "admin_check", description: "HTML чеклист" },
    { command: "admin_checklist", description: "Append рядок у чеклист" },
  ]);
}
async function clearCommands(env){
  await TG.setCommands(env.BOT_TOKEN, { type:"default" }, []);
  if (env.TELEGRAM_ADMIN_ID) {
    await TG.setCommands(env.BOT_TOKEN, { type:"chat", chat_id: Number(env.TELEGRAM_ADMIN_ID) }, []);
  }
}

// ---------------- HTTP worker ----------------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    try {
      // ---- Health ----
      if (p === "/") return html("Senti Worker Active");
      if (p === "/health") return json({ ok:true, service: env.SERVICE_HOST });

      // ---- TG helpers ----
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

      // Меню-підказки
      if (p === "/tg/install-commands-min") { await installCommandsMinimal(env); return json({ ok:true, installed:"minimal" }); }
      if (p === "/tg/clear-commands")       { await clearCommands(env);         return json({ ok:true, cleared:true }); }

      // ---- CI deploy note (через KV) ----
      if (p === "/ci/deploy-note") {
        const s = url.searchParams.get("s");
        if (env.WEBHOOK_SECRET && s !== env.WEBHOOK_SECRET) return json({ ok:false, error:"unauthorized" }, 401);
        const commit = url.searchParams.get("commit") || "";
        const actor  = url.searchParams.get("actor") || "";
        const depId  = url.searchParams.get("deploy") || env.DEPLOY_ID || "";
        const line = await logDeploy(env, { source:"ci", commit, actor, deployId: depId });
        return json({ ok:true, line });
      }

      // ---- Admin checklist HTML (захист секретом) ----
      if (p === "/admin/checklist/html") {
        const s = url.searchParams.get("s");
        if (env.WEBHOOK_SECRET && s !== env.WEBHOOK_SECRET) return html("<h3>401</h3>");
        if (req.method === "POST") {
          const form = await req.formData();
          const mode = (url.searchParams.get("mode") || "").toLowerCase();
          if (mode === "replace") {
            const full = form.get("full") || "";
            await writeChecklist(env, String(full));
          } else {
            const line = (form.get("line") || "").toString().trim();
            if (line) await appendChecklist(env, line);
          }
        }
        const text = await readChecklist(env);
        return checklistHtml({ text, submitPath: "/admin/checklist/html" });
      }

      // ---- Admin checklist JSON ----
      if (p === "/admin/checklist") {
        const s = url.searchParams.get("s");
        if (env.WEBHOOK_SECRET && s !== env.WEBHOOK_SECRET) return json({ ok:false, error:"unauthorized" }, 401);
        if (req.method === "POST") {
          const body = await req.json().catch(()=>({}));
          const line = (body.line || "").toString().trim();
          if (!line) return json({ ok:false, error:"line required" }, 400);
          const add = await appendChecklist(env, line);
          return json({ ok:true, added:add });
        }
        const text = await readChecklist(env);
        return json({ ok:true, text });
      }

      // ---- User OAuth (персональний Google Drive) ----
      if (p === "/auth/start") {
        const u = url.searchParams.get("u"); // telegram user id
        const state = btoa(JSON.stringify({ u }));
        const redirect_uri = `https://${env.SERVICE_HOST}/auth/cb`;
        const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        auth.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
        auth.searchParams.set("redirect_uri", redirect_uri);
        auth.searchParams.set("response_type", "code");
        auth.searchParams.set("access_type", "offline");
        auth.searchParams.set("prompt", "consent");
        auth.searchParams.set("scope", "https://www.googleapis.com/auth/drive.file");
        auth.searchParams.set("state", state);
        return Response.redirect(auth.toString(), 302);
      }
      if (p === "/auth/cb") {
        const state = JSON.parse(atob(url.searchParams.get("state")||"e30="));
        const code = url.searchParams.get("code");
        const redirect_uri = `https://${env.SERVICE_HOST}/auth/cb`;
        const body = new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri,
          grant_type: "authorization_code",
        });
        const r = await fetch("https://oauth2.googleapis.com/token", {
          method:"POST",
          headers:{ "Content-Type":"application/x-www-form-urlencoded" },
          body,
        });
        const d = await r.json();
        if(!r.ok) return html(`<pre>${JSON.stringify(d,null,2)}</pre>`);
        const tokens = {
          access_token: d.access_token,
          refresh_token: d.refresh_token,
          expiry: Math.floor(Date.now()/1000) + (d.expires_in||3600) - 60,
        };
        await putUserTokens(env, state.u, tokens);
        return html(`<h3>✅ Готово</h3><p>Тепер повернись у Telegram і натисни <b>Google Drive</b> ще раз.</p>`);
      }

      // ---- Telegram webhook ----
      if (p === "/webhook" && req.method !== "POST") return json({ ok:true, note:"webhook alive (GET)" });

      if (p === "/webhook" && req.method === "POST") {
        const sec = req.headers.get("x-telegram-bot-api-secret-token");
        if (env.TG_WEBHOOK_SECRET && sec !== env.TG_WEBHOOK_SECRET) return json({ ok:false, error:"unauthorized" }, 401);

        let update;
        try { update = await req.json(); }
        catch { return json({ ok:false }, 400); }

        const msg = update.message || update.edited_message || update.channel_post || update.callback_query?.message;
        const textRaw = update.message?.text || update.edited_message?.text || update.callback_query?.data || "";
        if (!msg) return json({ok:true});

        const chatId = msg.chat.id;
        const userId = msg.from?.id;
        const text = (textRaw || "").trim();

        const safe = async (fn) => {
          try { await fn(); }
          catch (e) { try { await TG.text(chatId, `❌ Помилка: ${String(e)}`, { token: env.BOT_TOKEN }); } catch {} }
        };

        // /start
        if (text === "/start") {
          await safe(async () => {
            const isAdmin = ADMIN(env, userId);
            await setDriveMode(env, userId, false);
            await TG.text(chatId, "Привіт! Я Senti 🤖", { token: env.BOT_TOKEN, reply_markup: mainKeyboard(isAdmin) });
          });
          return json({ok:true});
        }

        // Кнопка Google Drive (OAuth для всіх)
        if (text === BTN_DRIVE) {
          await safe(async () => {
            const ut = await getUserTokens(env, userId);
            if (!ut?.refresh_token) {
              const authUrl = `https://${env.SERVICE_HOST}/auth/start?u=${userId}`;
              await TG.text(chatId, `Дай доступ до свого Google Drive:\n${authUrl}\n\nПісля дозволу повернись у чат і ще раз натисни «${BTN_DRIVE}».`, { token: env.BOT_TOKEN });
              return;
            }
            await setDriveMode(env, userId, true);
            await TG.text(chatId, "📁 Режим диска: ON\nНадсилай фото/відео/документи — збережу на твій Google Drive.", { token: env.BOT_TOKEN, reply_markup: mainKeyboard(ADMIN(env, userId)) });
            await TG.text(chatId, "Переглянути вміст диска:", { token: env.BOT_TOKEN, reply_markup: inlineOpenDrive() });
          });
          return json({ok:true});
        }

        // Кнопка Senti — вимикає режим диска
        if (text === BTN_SENTI) {
          await safe(async () => {
            await setDriveMode(env, userId, false);
            await TG.text(chatId, "Режим диска вимкнено. Це звичайний чат Senti.", { token: env.BOT_TOKEN, reply_markup: mainKeyboard(ADMIN(env, userId)) });
          });
          return json({ok:true});
        }

        // Кнопка Checklist (для адміна)
        if (text === BTN_CHECK) {
          await safe(async () => {
            if (!ADMIN(env, userId)) { await TG.text(chatId, "⛔ Лише для адміна.", { token: env.BOT_TOKEN }); return; }
            const link = `https://${env.SERVICE_HOST}/admin/checklist/html?s=${encodeURIComponent(env.WEBHOOK_SECRET||"")}`;
            await TG.text(chatId, `📋 Чеклист (HTML):\n${link}`, { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }

        // Адмін-меню
        if (text === "Admin" || text === "/admin") {
          await safe(async () => {
            if (!ADMIN(env, userId)) { await TG.text(chatId, "⛔ Лише для адміна.", { token: env.BOT_TOKEN }); return; }
            await TG.text(chatId,
`🛠 Адмін-меню

• /admin_check — відкрити HTML чеклист
• /admin_checklist <рядок> — додати рядок у чеклист
• /admin_setwebhook — виставити вебхук
• /admin_refreshcheck — тест доступності (KV)
• /admin_note_deploy — тестова деплой-нотатка`,
              { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }

        // ------- ADMIN CMDS (KV) -------
        if (text.startsWith("/admin_check ")) {
          await safe(async () => {
            if (!ADMIN(env, userId)) return;
            const link = `https://${env.SERVICE_HOST}/admin/checklist/html?s=${encodeURIComponent(env.WEBHOOK_SECRET||"")}`;
            await TG.text(chatId, `📋 HTML: ${link}`, { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }

        if (text.startsWith("/admin_checklist")) {
          await safe(async () => {
            if (!ADMIN(env, userId)) return;
            const line = text.replace("/admin_checklist","").trim() || `tick ${new Date().toISOString()}`;
            await appendChecklist(env, line);
            await TG.text(chatId, `✅ Додано: ${line}`, { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }

        if (text.startsWith("/admin_setwebhook")) {
          await safe(async () => {
            if (!ADMIN(env, userId)) return;
            const target = `https://${env.SERVICE_HOST}/webhook`;
            await TG.setWebhook(env.BOT_TOKEN, target, env.TG_WEBHOOK_SECRET);
            await TG.text(chatId, `✅ Вебхук → ${target}${env.TG_WEBHOOK_SECRET ? " (секрет застосовано)" : ""}`, { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }

        if (text.startsWith("/admin_refreshcheck")) {
          await safe(async () => {
            if (!ADMIN(env, userId)) return;
            try { await appendChecklist(env, "refreshcheck ok"); await TG.text(chatId, `✅ KV OK (append)`, { token: env.BOT_TOKEN }); }
            catch (e) { await TG.text(chatId, `❌ KV failed: ${String(e)}`, { token: env.BOT_TOKEN }); }
          });
          return json({ok:true});
        }

        if (text.startsWith("/admin_note_deploy")) {
          await safe(async () => {
            if (!ADMIN(env, userId)) return;
            const line = await logDeploy(env, { source:"manual", actor:String(userId) });
            await TG.text(chatId, `📝 ${line}`, { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }

        // ---- Якщо режим ON — зберігаємо медіа на юзерський диск ----
        try {
          const mode = await getDriveMode(env, userId);
          if (mode) {
            const handled = await handleIncomingMedia(env, chatId, userId, msg);
            if (handled) return json({ ok:true });
          }
        } catch (mediaErr) {
          try { await TG.text(chatId, `❌ Не вдалось зберегти вкладення: ${String(mediaErr)}`, { token: env.BOT_TOKEN }); } catch {}
          return json({ ok:true });
        }

        // Дефолт
        await TG.text(chatId, "Готовий 👋", { token: env.BOT_TOKEN, reply_markup: mainKeyboard(ADMIN(env, userId)) });
        return json({ok:true});
      }

      // ---- test TG send after OAuth ----
      if (p === "/tg/test") {
        const u = url.searchParams.get("u");
        await TG.text(u, "Senti тут. Все працює ✅", { token: env.BOT_TOKEN });
        return json({ ok:true });
      }

      // ---- 404 ----
      return json({ ok:false, error:"Not found" }, 404);
    } catch (e) {
      return json({ ok:false, error:String(e) }, 500);
    }
  },

  // ---- CRON (heartbeat кожні 15 хв) ----
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try { await logHeartbeat(env); } catch (e) { /* ignore */ }
    })());
  }
};