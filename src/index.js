// src/index.js
import { drivePing, driveList, saveUrlToDrive, appendToChecklist, getAccessToken } from "./lib/drive.js";
import { TG } from "./lib/tg.js";
import { getUserTokens, putUserTokens, userListFiles, userSaveUrl } from "./lib/userDrive.js";

const ADMIN = (env, userId) => String(userId) === String(env.TELEGRAM_ADMIN_ID);

function html(s){ return new Response(s, {headers:{ "content-type":"text/html; charset=utf-8" }}) }
function json(o, status=200){ return new Response(JSON.stringify(o,null,2), {status, headers:{ "content-type":"application/json" }}) }

// ---------------- KV state keys ----------------
const DRIVE_MODE_KEY = (uid) => `drive_mode:${uid}`;
const LAST_DEPLOY_KEY = "last_deploy_id";

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

// ---------------- User tokens: get fresh access_token ----------------
async function getFreshUserAccessToken(env, userId){
  const rec = await getUserTokens(env, userId);
  if (!rec?.refresh_token) throw new Error("user_google: not linked");
  const now = Math.floor(Date.now()/1000);
  if (rec.access_token && rec.expiry && rec.expiry > now+30) return rec.access_token;

  // refresh
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: rec.refresh_token,
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method:"POST",
    headers:{ "Content-Type":"application/x-www-form-urlencoded" },
    body
  });
  const d = await r.json();
  if (!r.ok) throw new Error("refresh_user_token: "+JSON.stringify(d));
  const upd = {
    access_token: d.access_token,
    refresh_token: rec.refresh_token,
    expiry: Math.floor(Date.now()/1000) + (d.expires_in||3600) - 60,
  };
  await putUserTokens(env, userId, upd);
  return upd.access_token;
}

// ---------------- Upload helpers ----------------
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
async function userSaveText(env, userId, content, name){
  const access = await getFreshUserAccessToken(env, userId);
  const boundary = "----senti" + Math.random().toString(16).slice(2);
  const metadata = { name };
  const enc = new TextEncoder();

  const bodyParts = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) + `\r\n`,
    `--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n`,
  ];

  // assemble a readable stream to avoid huge string concat
  const stream = new ReadableStream({
    start(controller){
      controller.enqueue(enc.encode(bodyParts[0]));
      controller.enqueue(enc.encode(bodyParts[1]));
      controller.enqueue(enc.encode(content));
      controller.enqueue(enc.encode(`\r\n--${boundary}--\r\n`));
      controller.close();
    }
  });

  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method:"POST",
    headers:{
      "Authorization": `Bearer ${access}`,
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body: stream
  });
  const d = await r.json();
  if (!r.ok) throw new Error("userSaveText failed: "+JSON.stringify(d));
  return d; // {id, name, ...}
}

async function handleIncomingMedia(env, chatId, userId, msg){
  const att = detectAttachment(msg);
  if (!att) return false;

  // ensure linkage
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

async function handleIncomingText(env, chatId, userId, text){
  const isCmd = text.startsWith("/");
  if (isCmd) return false;
  const now = new Date().toISOString().replace(/[:.]/g,"-");
  const name = `text_${now}.md`;
  const md = `# From Telegram\n\n${text}\n`;
  const f = await userSaveText(env, userId, md, name);
  await TG.text(chatId, `✅ Збережено: ${f.name}`, { token: env.BOT_TOKEN });
  return true;
}

// ---------------- Keyboards ----------------
const BTN_DRIVE = "Google Drive";
const BTN_SENTI = "Senti";
const BTN_ADMIN = "Admin";
function mainKeyboard(isAdmin = false){
  const rows = [[{ text: BTN_DRIVE }, { text: BTN_SENTI }]];
  if (isAdmin) rows.push([{ text: BTN_ADMIN }]);
  return { keyboard: rows, resize_keyboard: true, one_time_keyboard: false };
}
function inlineOpenDrive(){
  return { inline_keyboard: [[{ text: "Відкрити Диск", url: "https://drive.google.com/drive/my-drive" }]] };
}

// ---------------- Commands installers ----------------
async function installCommandsMinimal(env){
  await TG.setCommands(env.BOT_TOKEN, { type:"default" }, []);
  if (!env.TELEGRAM_ADMIN_ID) throw new Error("TELEGRAM_ADMIN_ID not set");
  await TG.setCommands(env.BOT_TOKEN, { type:"chat", chat_id: Number(env.TELEGRAM_ADMIN_ID) }, [
    { command: "admin", description: "Відкрити адмін-меню" },
  ]);
}
async function clearCommands(env){
  await TG.setCommands(env.BOT_TOKEN, { type:"default" }, []);
  if (env.TELEGRAM_ADMIN_ID) {
    await TG.setCommands(env.BOT_TOKEN, { type:"chat", chat_id: Number(env.TELEGRAM_ADMIN_ID) }, []);
  }
}
async function nukeAllCommands(env){
  const langs = [undefined, "uk", "ru", "en", "uk-UA", "ru-RU", "en-US"];
  const scopes = [
    { type: "default" },
    { type: "all_private_chats" },
    { type: "all_group_chats" },
    { type: "all_chat_administrators" },
  ];
  for (const lang of langs) for (const scope of scopes) {
    const payload = { commands: [], scope };
    if (lang) payload.language_code = lang;
    try { await TG.api(env.BOT_TOKEN, "setMyCommands", payload); } catch (e) {}
  }
  if (env.TELEGRAM_ADMIN_ID) {
    for (const lang of langs) {
      const payload = { commands: [], scope: { type:"chat", chat_id:Number(env.TELEGRAM_ADMIN_ID) } };
      if (lang) payload.language_code = lang;
      try { await TG.api(env.BOT_TOKEN, "setMyCommands", payload); } catch (e) {}
    }
  }
}

// ---------------- Deploy log helpers ----------------
async function recordDeployIfChanged(env, note){
  const kv = ensureState(env);
  const newId = (note?.id || env.DEPLOY_ID || "").trim();
  if (!newId) return; // nothing to compare
  const prev = await kv.get(LAST_DEPLOY_KEY);
  if (prev === newId) return;
  await kv.put(LAST_DEPLOY_KEY, newId);
  try {
    const adminTok = await getAccessToken(env);
    const line = `[DEPLOY] ${new Date().toISOString()} | id=${newId}` +
      (note?.commit ? ` | commit=${note.commit}` : "") +
      (note?.branch ? ` | branch=${note.branch}` : "") +
      (note?.actor ? ` | by=${note.actor}` : "") +
      (note?.url ? ` | url=${note.url}` : "") +
      (env.SERVICE_HOST ? ` | host=${env.SERVICE_HOST}` : "");
    await appendToChecklist(env, adminTok, line);
  } catch (e) {
    console.log("append deploy failed", e);
  }
}

// ---------------- Worker export ----------------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    try {
      // ---- Health & helpers ----
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

      // Commands manage
      if (p === "/tg/install-commands-min") { await installCommandsMinimal(env); return json({ ok:true, installed:"minimal" }); }
      if (p === "/tg/clear-commands") { await clearCommands(env); return json({ ok:true, cleared:true }); }
      if (p === "/tg/nuke-commands") { await nukeAllCommands(env); return json({ ok:true, nuked:true }); }

      // ---- Admin Drive quick checks ----
      if (p === "/gdrive/ping") {
        try { const token = await getAccessToken(env); const files = await driveList(env, token); return json({ ok:true, files: files.files||[] }); }
        catch (e) { return json({ ok:false, error:String(e) }, 500); }
      }
      if (p === "/gdrive/save") {
        const token = await getAccessToken(env);
        const fileUrl = url.searchParams.get("url");
        const name = url.searchParams.get("name") || "from_web.md";
        const file = await saveUrlToDrive(env, token, fileUrl, name);
        return json({ ok:true, file });
      }
      if (p === "/gdrive/checklist") {
        const token = await getAccessToken(env,);
        const line = url.searchParams.get("line") || `tick ${new Date().toISOString()}`;
        await appendToChecklist(env, token, line);
        return json({ ok:true });
      }

      // ---- Deploy webhook ----
      if (p === "/deploy/webhook" && req.method === "POST") {
        const body = await req.json().catch(()=> ({}));
        await recordDeployIfChanged(env, {
          id: body.id || body.version || body.deploy_id || body.commit || "",
          commit: body.commit || body.sha,
          branch: body.branch || body.ref,
          actor: body.actor || body.author || body.user,
          url: body.url || body.preview_url || body.page || ""
        });
        return json({ ok:true, stored:true });
      }

      // ---- User OAuth (персональний Google Drive) ----
      if (p === "/auth/start") {
        const u = url.searchParams.get("u");
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

        const safe = async (fn) => { try { await fn(); } catch (e) { try { await TG.text(chatId, `❌ Помилка: ${String(e)}`, { token: env.BOT_TOKEN }); } catch {} } };

        // ----- UX -----
        if (text === "/start") {
          await safe(async () => {
            await setDriveMode(env, userId, false);
            const isAdmin = ADMIN(env, userId);
            await TG.text(chatId, "Привіт! Я Senti 🤖", { token: env.BOT_TOKEN, reply_markup: mainKeyboard(isAdmin) });
          });
          return json({ok:true});
        }

        // Buttons
        if (text === BTN_DRIVE) {
          await safe(async () => {
            const ut = await getUserTokens(env, userId);
            if (!ut?.refresh_token) {
              const authUrl = `https://${env.SERVICE_HOST}/auth/start?u=${userId}`;
              await TG.text(chatId, `Дай доступ до свого Google Drive:\n${authUrl}\n\nПісля дозволу повернись у чат і ще раз натисни «${BTN_DRIVE}».`, { token: env.BOT_TOKEN });
              return;
            }
            await setDriveMode(env, userId, true);
            const isAdmin = ADMIN(env, userId);
            await TG.text(chatId, "📁 Режим диска: ON\nНадсилай фото/відео/документи або текст — все збережу у твій Диск.", { token: env.BOT_TOKEN, reply_markup: mainKeyboard(isAdmin) });
            await TG.text(chatId, "Переглянути вміст диска:", { token: env.BOT_TOKEN, reply_markup: inlineOpenDrive() });
          });
          return json({ok:true});
        }
        if (text === BTN_SENTI) {
          await safe(async () => {
            await setDriveMode(env, userId, false);
            const isAdmin = ADMIN(env, userId);
            await TG.text(chatId, "Режим диска вимкнено. Це звичайний чат Senti.", { token: env.BOT_TOKEN, reply_markup: mainKeyboard(isAdmin) });
          });
          return json({ok:true});
        }
        if (text === BTN_ADMIN) {
          await safe(async () => {
            if (!ADMIN(env, userId)) { await TG.text(chatId, "⛔ Лише для адміна.", { token: env.BOT_TOKEN }); return; }
            await TG.text(chatId,
`🛠 Адмін-меню

• /admin_ping — ping адмін-диска
• /admin_list — список файлів (адмін-диск)
• /admin_checklist <рядок> — допис у чеклист
• /admin_setwebhook — виставити вебхук
• /admin_refreshcheck — ручний рефреш
• /view — відкрити мій Google Drive (посилання)`,
              { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }

        // Admin slash
        if (text === "/admin") {
          await safe(async () => {
            if (!ADMIN(env, userId)) { await TG.text(chatId, "⛔ Лише для адміна.", { token: env.BOT_TOKEN }); return; }
            await TG.text(chatId,
`🛠 Адмін-меню

• /admin_ping — ping адмін-диска
• /admin_list — список файлів (адмін-диск)
• /admin_checklist <рядок> — допис у чеклист
• /admin_setwebhook — виставити вебхук
• /admin_refreshcheck — ручний рефреш
• /view — відкрити мій Google Drive (посилання)`,
              { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }

        // Admin actions
        if (text.startsWith("/admin_ping")) {
          await safe(async () => { if (!ADMIN(env, userId)) return;
            const r = await drivePing(env);
            await TG.text(chatId, `✅ Admin Drive OK. filesCount: ${r.filesCount}`, { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }
        if (text.startsWith("/admin_list")) {
          await safe(async () => { if (!ADMIN(env, userId)) return;
            const once = async () => {
              const token = await getAccessToken(env);
              const files = await driveList(env, token);
              const arr = files.files || [];
              const msgOut = arr.length ? "Адмін диск:\n" + arr.map(f => `• ${f.name} (${f.id})`).join("\n") : "📁 Диск порожній.";
              await TG.text(chatId, msgOut, { token: env.BOT_TOKEN });
              try { await appendToChecklist(env, token, `admin_list OK ${new Date().toISOString()}`); } catch {}
            };
            try { await once(); } catch (e) { const s = String(e||""); if (s.includes("invalid_grant") || s.includes("Refresh 400")) { await once(); } else throw e; }
          });
          return json({ok:true});
        }
        if (text.startsWith("/admin_checklist")) {
          await safe(async () => { if (!ADMIN(env, userId)) return;
            const line = text.replace("/admin_checklist","").trim() || `tick ${new Date().toISOString()}`;
            const token = await getAccessToken(env);
            await appendToChecklist(env, token, line);
            await TG.text(chatId, `✅ Додано: ${line}`, { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }
        if (text.startsWith("/admin_setwebhook")) {
          await safe(async () => { if (!ADMIN(env, userId)) return;
            const target = `https://${env.SERVICE_HOST}/webhook`;
            await TG.setWebhook(env.BOT_TOKEN, target, env.TG_WEBHOOK_SECRET);
            await TG.text(chatId, `✅ Вебхук → ${target}${env.TG_WEBHOOK_SECRET ? " (секрет застосовано)" : ""}`, { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }
        if (text.startsWith("/admin_refreshcheck")) {
          await safe(async () => { if (!ADMIN(env, userId)) return;
            try { const tok = await getAccessToken(env); if (tok) await TG.text(chatId, `✅ Refresh OK (отримано access_token).`, { token: env.BOT_TOKEN }); }
            catch (e) { await TG.text(chatId, `❌ Refresh failed: ${String(e)}`, { token: env.BOT_TOKEN }); }
          });
          return json({ok:true});
        }

        // User helpers
        if (text === "/view") {
          await safe(async () => {
            await TG.text(chatId, "Твій Google Drive:", { token: env.BOT_TOKEN, reply_markup: inlineOpenDrive() });
          });
          return json({ok:true});
        }

        // ---- Drive-mode: save media/text automatically ----
        try {
          const mode = await getDriveMode(env, userId);
          if (mode) {
            if (await handleIncomingMedia(env, chatId, userId, msg)) return json({ ok:true });
            if (text) {
              if (await handleIncomingText(env, chatId, userId, text)) return json({ ok:true });
            }
          }
        } catch (mediaErr) {
          try { await TG.text(chatId, `❌ Не вдалось зберегти: ${String(mediaErr)}`, { token: env.BOT_TOKEN }); } catch {}
          return json({ ok:true });
        }

        // default echo/keyboard refresh
        await safe(async () => {
          const isAdmin = ADMIN(env, userId);
          await TG.text(chatId, "Готовий 👋", { token: env.BOT_TOKEN, reply_markup: mainKeyboard(isAdmin) });
        });
        return json({ok:true});
      }

      // ---- test TG send after OAuth ----
      if (p === "/tg/test") {
        const u = url.searchParams.get("u");
        await TG.text(u, "Senti тут. Все працює ✅", { token: env.BOT_TOKEN });
        return json({ ok:true });
      }

      // 404
      return json({ ok:false, error:"Not found" }, 404);
    } catch (e) {
      return json({ ok:false, error:String(e) }, 500);
    }
  },

  // ---- CRON: every 15 min (configure in wrangler.toml) ----
  async scheduled(event, env, ctx){
    await recordDeployIfChanged(env, { id: env.DEPLOY_ID });
  }
};