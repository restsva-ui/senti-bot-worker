// src/index.js
import { TG } from "./lib/tg.js";
import { getUserTokens, putUserTokens, userListFiles, userSaveUrl } from "./lib/userDrive.js";

import {
  readChecklist, writeChecklist, appendChecklist, checklistHtml,
  saveArchive, listArchives, getArchive, deleteArchive,
  readStatut, writeStatut, statutHtml
} from "./lib/kvChecklist.js";
import { logHeartbeat, logDeploy } from "./lib/audit.js";

// 🧠 підключення мозку Senti (додай файл src/brain/sentiCore.js)
import { SentiCore } from "./brain/sentiCore.js";

// ---------- utils ----------
const ADMIN = (env, userId) => String(userId) === String(env.TELEGRAM_ADMIN_ID);
const html = (s)=> new Response(s, {headers:{ "content-type":"text/html; charset=utf-8" }});
const json = (o, status=200)=> new Response(JSON.stringify(o,null,2), {status, headers:{ "content-type":"application/json" }});
// абсолютний URL з шляху
const abs = (env, path) => `https://${env.SERVICE_HOST}${path}`;

// ---------- drive-mode state ----------
const DRIVE_MODE_KEY = (uid) => `drive_mode:${uid}`;
function ensureState(env) { if (!env.STATE_KV) throw new Error("STATE_KV binding missing"); return env.STATE_KV; }
async function setDriveMode(env, userId, on){ await ensureState(env).put(DRIVE_MODE_KEY(userId), on?"1":"0", {expirationTtl:3600}); }
async function getDriveMode(env, userId){ return (await ensureState(env).get(DRIVE_MODE_KEY(userId)))==="1"; }

// ---------- media helpers ----------
function pickPhoto(msg){ const a=msg.photo; if(!Array.isArray(a)||!a.length) return null; const ph=a[a.length-1]; return {type:"photo",file_id:ph.file_id,name:`photo_${ph.file_unique_id}.jpg`}; }
function detectAttachment(msg){
  if (!msg) return null;
  if (msg.document) { const d=msg.document; return {type:"document",file_id:d.file_id,name:d.file_name||`document_${d.file_unique_id}`}; }
  if (msg.video)    { const v=msg.video;    return {type:"video",file_id:v.file_id,name:v.file_name||`video_${v.file_unique_id}.mp4`}; }
  if (msg.audio)    { const a=msg.audio;    return {type:"audio",file_id:a.file_id,name:a.file_name||`audio_${a.file_unique_id}.mp3`}; }
  if (msg.voice)    { const v=msg.voice;    return {type:"voice",file_id:v.file_id,name:`voice_${v.file_unique_id}.ogg`}; }
  if (msg.video_note){const v=msg.video_note;return {type:"video_note",file_id:v.file_id,name:`videonote_${v.file_unique_id}.mp4`};}
  return pickPhoto(msg);
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
    await TG.text(chatId,"Щоб зберігати у свій Google Drive — спочатку натисни «Google Drive» і дозволь доступ.",{token:env.BOT_TOKEN});
    return true;
  }
  const url = await tgFileUrl(env, att.file_id);
  const saved = await userSaveUrl(env, userId, url, att.name);
  await TG.text(chatId, `✅ Збережено на твоєму диску: ${saved.name}`, { token: env.BOT_TOKEN });
  return true;
}

// ---------- keyboards ----------
const BTN_DRIVE="Google Drive", BTN_SENTI="Senti", BTN_ADMIN="Admin", BTN_CHECK="Checklist";
function mainKeyboard(isAdmin=false){ const rows=[[{text:BTN_DRIVE},{text:BTN_SENTI}]]; if(isAdmin) rows.push([{text:BTN_ADMIN},{text:BTN_CHECK}]); return {keyboard:rows,resize_keyboard:true}; }
const inlineOpenDrive = ()=>({ inline_keyboard: [[{ text:"Відкрити Диск", url:"https://drive.google.com/drive/my-drive"}]] });

// ---------- commands ----------
async function installCommandsMinimal(env){
  await TG.setCommands(env.BOT_TOKEN,{type:"default"},[]);
  if(!env.TELEGRAM_ADMIN_ID) throw new Error("TELEGRAM_ADMIN_ID not set");
  await TG.setCommands(env.BOT_TOKEN,{type:"chat",chat_id:Number(env.TELEGRAM_ADMIN_ID)},[
    {command:"admin",description:"Адмін-меню"},
    {command:"admin_check",description:"HTML чеклист"},
    {command:"admin_checklist",description:"Append рядок у чеклист"},
    // нові
    {command:"admin_start_mind",description:"Запустити мозок Senti"},
    {command:"admin_snapshot",description:"Env snapshot → чеклист"},
  ]);
}
async function clearCommands(env){
  await TG.setCommands(env.BOT_TOKEN,{type:"default"},[]);
  if(env.TELEGRAM_ADMIN_ID){ await TG.setCommands(env.BOT_TOKEN,{type:"chat",chat_id:Number(env.TELEGRAM_ADMIN_ID)},[]); }
}

// ---------- HTTP worker ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    const needSecret = () => (env.WEBHOOK_SECRET && (url.searchParams.get("s") !== env.WEBHOOK_SECRET));

    try {
      // health
      if (p === "/") return html("Senti Worker Active");
      if (p === "/health") return json({ ok:true, service: env.SERVICE_HOST });

      // tg helpers
      if (p === "/tg/get-webhook") { const r=await TG.getWebhook(env.BOT_TOKEN); return new Response(await r.text(),{headers:{'content-type':'application/json'}}); }
      if (p === "/tg/set-webhook") { const target=abs(env,"/webhook"); const r=await TG.setWebhook(env.BOT_TOKEN,target,env.TG_WEBHOOK_SECRET); return new Response(await r.text(),{headers:{'content-type':'application/json'}}); }
      if (p === "/tg/del-webhook") { const r=await TG.deleteWebhook?.(env.BOT_TOKEN)||await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/deleteWebhook`); return new Response(await r.text(),{headers:{'content-type':'application/json'}}); }

      if (p === "/tg/install-commands-min") { await installCommandsMinimal(env); return json({ok:true}); }
      if (p === "/tg/clear-commands")       { await clearCommands(env);       return json({ok:true}); }

      // CI deploy note
      if (p === "/ci/deploy-note") {
        if (needSecret()) return json({ ok:false, error:"unauthorized" }, 401);
        const commit=url.searchParams.get("commit")||"", actor=url.searchParams.get("actor")||"", depId=url.searchParams.get("deploy")||env.DEPLOY_ID||"", status=url.searchParams.get("status")||"";
        const line = await logDeploy(env,{source:"ci",commit,actor,deployId:depId,status});
        return json({ ok:true, line });
      }

      // -------- Checklist HTML + upload ----------
      if (p === "/admin/checklist/html") {
        if (needSecret()) return html("<h3>401</h3>");
        if (req.method === "POST") {
          const ct = req.headers.get("content-type") || "";
          if (!/form/.test(ct)) return json({ ok:false, error:"unsupported content-type" }, 415);
          const form = await req.formData();
          const mode = (url.searchParams.get("mode")||"").toLowerCase();
          if (mode === "replace") {
            await writeChecklist(env, String(form.get("full") ?? ""));
          } else {
            const line = String(form.get("line")||"").trim();
            if (line) await appendChecklist(env, line);
          }
        }
        const text = await readChecklist(env);
        return checklistHtml({ text, submitPath: abs(env,"/admin/checklist/html"), secret: env.WEBHOOK_SECRET || "" });
      }

      // файл -> архів -> посилання у чеклист
      if (p === "/admin/checklist/upload" && req.method === "POST") {
        if (needSecret()) return json({ ok:false, error:"unauthorized" }, 401);
        const form = await req.formData();
        const file = form.get("file");
        if (!file) return json({ ok:false, error:"file required" }, 400);
        const key = await saveArchive(env, file);
        const urlKey = encodeURIComponent(key);
        const who = url.searchParams.get("who") || "";
        const note = `upload: ${(file.name||"file")} (${file.size||"?"} bytes) → /admin/archive/get?key=${urlKey}${env.WEBHOOK_SECRET?`&s=${encodeURIComponent(env.WEBHOOK_SECRET)}`:""}${who?`&who=${encodeURIComponent(who)}`:""}`;
        await appendChecklist(env, note);
        return Response.redirect(abs(env, `/admin/checklist/html${env.WEBHOOK_SECRET?`?s=${encodeURIComponent(env.WEBHOOK_SECRET)}`:""}`), 302);
      }

      // JSON API чеклисту
      if (p === "/admin/checklist") {
        if (needSecret()) return json({ ok:false, error:"unauthorized" }, 401);
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

      // -------- Архів/Repo UI ----------
      if (p === "/admin/repo/html") {
        if (needSecret()) return html("<h3>401</h3>");
        const keys = await listArchives(env);

        const withSec = (base, hasQuery=false) => {
          if (!env.WEBHOOK_SECRET) return base;
          return base + (hasQuery ? "&" : "?") + "s=" + encodeURIComponent(env.WEBHOOK_SECRET);
        };

        const list = keys.map(k => {
          const key = encodeURIComponent(k);
          const hrefGet    = withSec(`/admin/archive/get?key=${key}`,    true);
          const hrefDelete = withSec(`/admin/archive/delete?key=${key}`, true);
          return `<li><a href="${hrefGet}">${k}</a> — <a href="${hrefDelete}" onclick="return confirm('Delete?')">🗑</a></li>`;
        }).join("") || "<li>Порожньо</li>";

        const backChecklist = withSec("/admin/checklist/html");
        return html(`<!doctype html><meta charset="utf-8"><title>Repo</title>
        <div style="font-family:system-ui;margin:20px;max-width:900px">
          <h2>📚 Архів (Repo)</h2>
          <p><a href="${backChecklist}">⬅ До Checklist</a></p>
          <ul>${list}</ul>
        </div>`);
      }

      if (p === "/admin/archive/get") {
        if (needSecret()) return json({ ok:false, error:"unauthorized" }, 401);
        const key = url.searchParams.get("key");
        if (!key) return json({ ok:false, error:"key required" }, 400);
        const b64 = await getArchive(env, key);
        if (!b64) return json({ ok:false, error:"not found" }, 404);
        const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        return new Response(bin, { headers:{ "content-type":"application/octet-stream" }});
      }

      if (p === "/admin/archive/delete") {
        if (needSecret()) return json({ ok:false, error:"unauthorized" }, 401);
        const key = url.searchParams.get("key");
        if (!key) return json({ ok:false, error:"key required" }, 400);
        await deleteArchive(env, key);
        return Response.redirect(abs(env, `/admin/repo/html${env.WEBHOOK_SECRET?`?s=${encodeURIComponent(env.WEBHOOK_SECRET)}`:""}`), 302);
      }

      // -------- STATUT ----------
      if (p === "/admin/statut/html") {
        if (needSecret()) return html("<h3>401</h3>");
        if (req.method === "POST") {
          const form = await req.formData();
          await writeStatut(env, String(form.get("full") ?? ""));
        }
        const text = await readStatut(env);
        return statutHtml({ text, submitPath: abs(env,"/admin/statut/html"), secret: env.WEBHOOK_SECRET || "" });
      }

      // -------- Brain (адмін REST) ----------
      if (p === "/admin/brain/boot") {
        if (needSecret()) return json({ ok:false, error:"unauthorized" }, 401);
        const r = await SentiCore.boot(env, "admin");
        return json({ ok:true, ...r });
      }
      if (p === "/admin/brain/check") {
        if (needSecret()) return json({ ok:false, error:"unauthorized" }, 401);
        const r = await SentiCore.selfCheck(env);
        return json({ ok:true, ...r });
      }
      if (p === "/admin/brain/snapshot") {
        if (needSecret()) return json({ ok:false, error:"unauthorized" }, 401);
        const r = await SentiCore.snapshot(env);
        return json({ ok:true, ...r });
      }

      // ---------- Telegram webhook ----------
      if (p === "/webhook" && req.method !== "POST") return json({ ok:true, note:"webhook alive (GET)" });
      if (p === "/webhook" && req.method === "POST") {
        const sec = req.headers.get("x-telegram-bot-api-secret-token");
        if (env.TG_WEBHOOK_SECRET && sec !== env.TG_WEBHOOK_SECRET) return json({ ok:false, error:"unauthorized" }, 401);

        let update; try { update = await req.json(); } catch { return json({ ok:false }, 400); }
        const msg = update.message || update.edited_message || update.channel_post || update.callback_query?.message;
        const textRaw = update.message?.text || update.edited_message?.text || update.callback_query?.data || "";
        if (!msg) return json({ ok:true });

        const chatId = msg.chat.id, userId = msg.from?.id, text = (textRaw||"").trim();
        const safe = async (fn)=>{ try{ await fn(); } catch(e){ try{ await TG.text(chatId, `❌ Помилка: ${String(e)}`, { token: env.BOT_TOKEN }); }catch{} } };

        if (text === "/start") { await safe(async ()=>{
          const isAdmin = ADMIN(env, userId); await setDriveMode(env, userId, false);
          await TG.text(chatId, "Привіт! Я Senti 🤖", { token: env.BOT_TOKEN, reply_markup: mainKeyboard(isAdmin) });
        }); return json({ok:true}); }

        if (text === BTN_DRIVE) { await safe(async ()=>{
          const ut = await getUserTokens(env, userId);
          if (!ut?.refresh_token) {
            const authUrl = abs(env, `/auth/start?u=${userId}`);
            await TG.text(chatId, `Дай доступ до свого Google Drive:\n${authUrl}\n\nПісля дозволу повернись у чат і ще раз натисни «${BTN_DRIVE}».`, { token: env.BOT_TOKEN });
            return;
          }
          await setDriveMode(env, userId, true);
          await TG.text(chatId, "📁 Режим диска: ON\nНадсилай фото/відео/документи — збережу на твій Google Drive.", { token: env.BOT_TOKEN, reply_markup: mainKeyboard(ADMIN(env, userId)) });
          await TG.text(chatId, "Переглянути вміст диска:", { token: env.BOT_TOKEN, reply_markup: inlineOpenDrive() });
        }); return json({ok:true}); }

        if (text === BTN_SENTI) { await safe(async ()=>{
          await setDriveMode(env, userId, false);
          await TG.text(chatId, "Режим диска вимкнено. Це звичайний чат Senti.", { token: env.BOT_TOKEN, reply_markup: mainKeyboard(ADMIN(env, userId)) });
        }); return json({ok:true}); }

        if (text === BTN_CHECK) { await safe(async ()=>{
          if (!ADMIN(env, userId)) { await TG.text(chatId, "⛔ Лише для адміна.", { token: env.BOT_TOKEN }); return; }
          const link = abs(env, `/admin/checklist/html?s=${encodeURIComponent(env.WEBHOOK_SECRET||"")}`);
          await TG.text(chatId, `📋 Чеклист (HTML):\n${link}`, { token: env.BOT_TOKEN });
        }); return json({ok:true}); }

        if (text === "Admin" || text === "/admin") { await safe(async ()=>{
          if (!ADMIN(env, userId)) { await TG.text(chatId, "⛔ Лише для адміна.", { token: env.BOT_TOKEN }); return; }
          await TG.text(chatId,
`🛠 Адмін-меню

• /admin_check — відкрити HTML чеклист
• /admin_checklist <рядок> — додати рядок у чеклист
• /admin_setwebhook — виставити вебхук
• /admin_refreshcheck — тест доступності (KV)
• /admin_note_deploy — тестова деплой-нотатка
• /admin_start_mind — запустити мозок
• /admin_snapshot — env snapshot`,
          { token: env.BOT_TOKEN });
        }); return json({ok:true}); }

        if (text === "/admin_check") { await safe(async ()=>{
          if (!ADMIN(env, userId)) return;
          const link = abs(env, `/admin/checklist/html?s=${encodeURIComponent(env.WEBHOOK_SECRET||"")}`);
          await TG.text(chatId, `📋 HTML: ${link}`, { token: env.BOT_TOKEN });
        }); return json({ok:true}); }

        if (text === "/admin_start_mind") { await safe(async ()=>{
          if (!ADMIN(env, userId)) return;
          await SentiCore.boot(env, "tg");
          await TG.text(chatId, `🧠 Мозок Senti запущено`, { token: env.BOT_TOKEN });
        }); return json({ok:true}); }

        if (text === "/admin_snapshot") { await safe(async ()=>{
          if (!ADMIN(env, userId)) return;
          await SentiCore.snapshot(env);
          await TG.text(chatId, `📦 Snapshot додано у чеклист`, { token: env.BOT_TOKEN });
        }); return json({ok:true}); }

        if (text.startsWith("/admin_checklist")) { await safe(async ()=>{
          if (!ADMIN(env, userId)) return;
          const line = text.replace("/admin_checklist","").trim() || `tick ${new Date().toISOString()}`;
          await appendChecklist(env, line);
          await TG.text(chatId, `✅ Додано: ${line}`, { token: env.BOT_TOKEN });
        }); return json({ok:true}); }

        if (text.startsWith("/admin_setwebhook")) { await safe(async ()=>{
          if (!ADMIN(env, userId)) return;
          const target=abs(env,"/webhook");
          await TG.setWebhook(env.BOT_TOKEN, target, env.TG_WEBHOOK_SECRET);
          await TG.text(chatId, `✅ Вебхук → ${target}${env.TG_WEBHOOK_SECRET?" (секрет застосовано)":""}`, { token: env.BOT_TOKEN });
        }); return json({ok:true}); }

        if (text.startsWith("/admin_refreshcheck")) { await safe(async ()=>{
          if (!ADMIN(env, userId)) return;
          try{ await appendChecklist(env,"refreshcheck ok"); await TG.text(chatId,"✅ KV OK (append)",{token:env.BOT_TOKEN}); }
          catch(e){ await TG.text(chatId,`❌ KV failed: ${String(e)}`,{token:env.BOT_TOKEN}); }
        }); return json({ok:true}); }

        if (text.startsWith("/admin_note_deploy")) { await safe(async ()=>{
          if (!ADMIN(env, userId)) return;
          const line = await logDeploy(env, { source:"manual", actor:String(userId) });
          await TG.text(chatId, `📝 ${line}`, { token: env.BOT_TOKEN });
        }); return json({ok:true}); }

        // Drive-mode media
        try {
          if (await getDriveMode(env, userId)) {
            if (await handleIncomingMedia(env, chatId, userId, msg)) return json({ ok:true });
          }
        } catch (e) { try{ await TG.text(chatId,`❌ Не вдалось зберегти вкладення: ${String(e)}`,{token:env.BOT_TOKEN}); }catch{} return json({ok:true}); }

        await TG.text(chatId, "Готовий 👋", { token: env.BOT_TOKEN, reply_markup: mainKeyboard(ADMIN(env, userId)) });
        return json({ ok:true });
      }

      // OAuth
      if (p === "/auth/start") {
        const u = url.searchParams.get("u");
        const state = btoa(JSON.stringify({ u }));
        const redirect_uri = abs(env,"/auth/cb");
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
        const redirect_uri = abs(env,"/auth/cb");
        const body = new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri, grant_type: "authorization_code" });
        const r = await fetch("https://oauth2.googleapis.com/token",{ method:"POST", headers:{ "Content-Type":"application/x-www-form-urlencoded" }, body });
        const d = await r.json();
        if(!r.ok) return html(`<pre>${JSON.stringify(d,null,2)}</pre>`);
        const tokens = { access_token:d.access_token, refresh_token:d.refresh_token, expiry:Math.floor(Date.now()/1000)+(d.expires_in||3600)-60 };
        await putUserTokens(env, state.u, tokens);
        return html(`<h3>✅ Готово</h3><p>Тепер повернись у Telegram і натисни <b>Google Drive</b> ще раз.</p>`);
      }

      return json({ ok:false, error:"Not found" }, 404);
    } catch (e) {
      return json({ ok:false, error:String(e) }, 500);
    }
  },

  // ---- CRON (heartbeat кожні 15 хв) ----
  async scheduled(event, env, ctx) {
    await logHeartbeat(env);
  }
};