// src/index.js
import { TG } from "./lib/tg.js";
import { getUserTokens, putUserTokens, userListFiles, userSaveUrl } from "./lib/userDrive.js";

import {
  readChecklist, writeChecklist, appendChecklist, checklistHtml,
  saveArchive, listArchives, getArchive, deleteArchive,
  readStatut, writeStatut, statutHtml
} from "./lib/kvChecklist.js";
import { logHeartbeat, logDeploy } from "./lib/audit.js";
import { SentiCore } from "./brain/sentiCore.js";

// ---------- utils ----------
import { abs } from "./utils/url.js";

// маршрути (переконайся, що ці файли існують)
import { handleAdminRepo } from "./routes/adminRepo.js";
import { handleAdminChecklist } from "./routes/adminChecklist.js";
import { handleAdminStatut } from "./routes/adminStatut.js";

const ADMIN = (env, userId) => String(userId) === String(env.TELEGRAM_ADMIN_ID);
const html = (s)=> new Response(s, {headers:{ "content-type":"text/html; charset=utf-8" }});
const json = (o, status=200)=> new Response(JSON.stringify(o,null,2), {status, headers:{ "content-type":"application/json" }});

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
      if (p === "/") return html("Senti Worker Active");
      if (p === "/health") return json({ ok:true, service: env.SERVICE_HOST });

      // --- модульні роутери ---
      if (p.startsWith("/admin/checklist")) {
        const r = await handleAdminChecklist(req, env, url);
        if (r) return r;
      }
      if (p.startsWith("/admin/repo") || p.startsWith("/admin/archive")) {
        const r = await handleAdminRepo(req, env, url);
        if (r) return r;
      }
      if (p.startsWith("/admin/statut")) {
        const r = await handleAdminStatut(req, env, url);
        if (r) return r;
      }

      // --- решта зеленого коду (webhook, drive, auth, brain) без змін ---
      if (p === "/webhook" && req.method !== "POST") return json({ ok:true, note:"webhook alive (GET)" });
      // ... (твій чинний код із зеленого деплою тут залишається як є)
      return json({ ok:false, error:"Not found" }, 404);

    } catch (e) {
      return json({ ok:false, error:String(e) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    await logHeartbeat(env);
  }
};