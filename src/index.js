// src/index.js
import { drivePing, driveList, saveUrlToDrive, appendToChecklist, getAccessToken } from "./lib/drive.js";
import { TG } from "./lib/tg.js";
import { getUserTokens, putUserTokens, userListFiles, userSaveUrl } from "./lib/userDrive.js";

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
  await kv.put(DRIVE_MODE_KEY(userId), on ? "1" : "0", { expirationTtl: 3600 }); // TTL 1h
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
    await TG.text(chatId, "Щоб зберігати у свій Google Drive — спочатку зроби /user → /link_drive", { token: env.BOT_TOKEN });
    return true;
  }

  const url = await tgFileUrl(env, att.file_id);
  const saved = await userSaveUrl(env, userId, url, att.name);
  await TG.text(chatId, `✅ Збережено на твоєму диску: ${saved.name}`, { token: env.BOT_TOKEN });
  return true;
}

// ---------------- Menu presets ----------------
function userMenuKeyboard(){
  return {
    keyboard: [
      [{text:"/link_drive"},{text:"/my_files"}],
      [{text:"/drive_on"},{text:"/drive_off"}],
      [{text:"/save"}],
      [{text:"/ping"}],
    ],
    resize_keyboard: true
  };
}
function adminMenuKeyboard(){
  return {
    keyboard: [
      [{text:"/admin_ping"},{text:"/admin_list"}],
      [{text:"/admin_checklist tick"},{text:"/admin_refreshcheck"}],
      [{text:"/admin_setwebhook"}],
      [{text:"/user"}]
    ],
    resize_keyboard: true
  };
}

// ---------------- Commands installers ----------------
async function installCommands(env){
  // 1) Глобальні (дефолтні) — показуємо лише /user (щоб не засмічувати меню)
  await TG.setCommands(env.BOT_TOKEN, { type:"default" }, [
    { command: "user", description: "Відкрити меню користувача" },
  ]);

  // 2) Персонально для адміна — тільки /admin (видно лише тобі, в твоєму приватному чаті)
  if (!env.TELEGRAM_ADMIN_ID) throw new Error("TELEGRAM_ADMIN_ID not set");
  await TG.setCommands(env.BOT_TOKEN, { type:"chat", chat_id: Number(env.TELEGRAM_ADMIN_ID) }, [
    { command: "admin", description: "Відкрити адмін-меню" },
  ]);
}

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

      // NEW: інсталяція команд
      if (p === "/tg/install-commands") {
        await installCommands(env);
        return json({ ok:true, installed:true });
      }

      // ---- Admin Drive quick checks ----
      if (p === "/gdrive/ping") {
        try {
          const token = await getAccessToken(env);
          const files = await driveList(env, token);
          return json({ ok: true, files: files.files || [] });
        } catch (e) { return json({ ok:false, error:String(e) }, 500); }
      }

      if (p === "/gdrive/save") {
        const token = await getAccessToken(env);
        const fileUrl = url.searchParams.get("url");
        const name = url.searchParams.get("name") || "from_web.md";
        const file = await saveUrlToDrive(env, token, fileUrl, name);
        return json({ ok:true, file });
      }

      if (p === "/gdrive/checklist") {
        const token = await getAccessToken(env);
        const line = url.searchParams.get("line") || `tick ${new Date().toISOString()}`;
        await appendToChecklist(env, token, line);
        return json({ ok:true });
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
        return html(`<h3>✅ Редирект працює</h3>
<p>Отримали та зберегли токени для користувача <b>${state.u}</b>.</p>
<ul>
<li><a href="/tg/test?u=${state.u}">/tg/test</a></li>
<li><a href="/webhook">/webhook</a> (вебхук)</li>
</ul>`);
      }

      // ---- Telegram webhook ----

      // GET /webhook — швидкий ping
      if (p === "/webhook" && req.method !== "POST") {
        return json({ ok:true, note:"webhook alive (GET)" });
      }

      // POST /webhook — прийом апдейтів (із перевіркою секрету, якщо заданий)
      if (p === "/webhook" && req.method === "POST") {
        const sec = req.headers.get("x-telegram-bot-api-secret-token");
        if (env.TG_WEBHOOK_SECRET && sec !== env.TG_WEBHOOK_SECRET) {
          console.log("Webhook: wrong secret", sec);
          return json({ ok:false, error:"unauthorized" }, 401);
        }

        // Приймаємо та логуємо апдейт
        let update;
        try {
          update = await req.json();
          console.log("TG update:", JSON.stringify(update).slice(0, 2000));
        } catch (e) {
          console.log("Webhook parse error:", e);
          return json({ ok:false }, 400);
        }

        const msg = update.message || update.edited_message || update.channel_post || update.callback_query?.message;
        const textRaw = update.message?.text || update.edited_message?.text || update.callback_query?.data || "";
        if (!msg) return json({ok:true});

        const chatId = msg.chat.id;
        const userId = msg.from?.id;
        const text = (textRaw || "").trim();

        // обгортка: будь-яка помилка піде в чат
        const safe = async (fn) => {
          try { await fn(); }
          catch (e) {
            console.log("Handler error:", e);
            try { await TG.text(chatId, `❌ Помилка: ${String(e)}`, { token: env.BOT_TOKEN }); } catch {}
          }
        };

        // ---------------- TOP-LEVEL MENUS ----------------
        if (text === "/start") {
          await safe(async () => {
            const isAdmin = ADMIN(env, userId);
            const base = "Привіт! Я Senti 🤖\n\nДоступні меню:\n• /user — меню користувача";
            const tail = isAdmin ? "\n• /admin — адмін-меню (видно тільки власнику)" : "";
            await TG.text(chatId, base + tail, { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }

        if (text === "/user") {
          await safe(async () => {
            await TG.text(
              chatId,
              `👤 Користувацьке меню

• /link_drive — прив'язати мій Google Drive
• /my_files — мої файли з диску
• /save_url <url> <name> — зберегти файл з URL у мій диск
• /drive_on — автозбереження медіа (1 год)
• /drive_off — вимкнути автозбереження
• /save — відповісти на медіа, щоб зберегти саме його
• /drive_status — стан режиму
• /ping — перевірити, що бот живий`,
              { token: env.BOT_TOKEN, reply_markup: userMenuKeyboard() }
            );
          });
          return json({ok:true});
        }

        if (text === "/admin") {
          await safe(async () => {
            if (!ADMIN(env, userId)) {
              await TG.text(chatId, "⛔ Лише для адміна.", { token: env.BOT_TOKEN });
              return;
            }
            await TG.text(
              chatId,
              `🛠 Адмін-меню

• /admin_ping — ping адмін-диска
• /admin_list — список файлів (адмін-диск)
• /admin_checklist <рядок> — допис у чеклист
• /admin_setwebhook — виставити вебхук
• /admin_refreshcheck — ручний рефреш`,
              { token: env.BOT_TOKEN, reply_markup: adminMenuKeyboard() }
            );
          });
          return json({ok:true});
        }

        // ---------------- ADMIN CMDS ----------------
        if (text.startsWith("/admin_ping")) {
          await safe(async () => {
            if (!ADMIN(env, userId)) return;
            const r = await drivePing(env);
            await TG.text(chatId, `✅ Admin Drive OK. filesCount: ${r.filesCount}`, { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }

        if (text.startsWith("/admin_list")) {
          await safe(async () => {
            if (!ADMIN(env, userId)) return;
            const once = async () => {
              const token = await getAccessToken(env);
              const files = await driveList(env, token);
              const arr = files.files || [];
              const msgOut = arr.length
                ? "Адмін диск:\n" + arr.map(f => `• ${f.name} (${f.id})`).join("\n")
                : "📁 Диск порожній.";
              await TG.text(chatId, msgOut, { token: env.BOT_TOKEN });
              try { await appendToChecklist(env, token, `admin_list OK ${new Date().toISOString()}`); } catch {}
            };
            try { await once(); }
            catch (e) {
              const s = String(e || "");
              if (s.includes("invalid_grant") || s.includes("Refresh 400")) { await once(); }
              else throw e;
            }
          });
          return json({ok:true});
        }

        if (text.startsWith("/admin_checklist")) {
          await safe(async () => {
            if (!ADMIN(env, userId)) return;
            const line = text.replace("/admin_checklist","").trim() || `tick ${new Date().toISOString()}`;
            const token = await getAccessToken(env);
            await appendToChecklist(env, token, line);
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
            try {
              const tok = await getAccessToken(env);
              if (tok) await TG.text(chatId, `✅ Refresh OK (отримано access_token).`, { token: env.BOT_TOKEN });
            } catch (e) {
              await TG.text(chatId, `❌ Refresh failed: ${String(e)}`, { token: env.BOT_TOKEN });
            }
          });
          return json({ok:true});
        }

        // ---------------- USER CMDS ----------------
        if (text === "/link_drive") {
          await safe(async () => {
            const authUrl = `https://${env.SERVICE_HOST}/auth/start?u=${userId}`;
            await TG.text(chatId, `Перейди за посиланням і дозволь доступ до свого Google Drive (режим *drive.file*):\n${authUrl}`, { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }

        if (text === "/unlink_drive") {
          await safe(async () => {
            await putUserTokens(env, userId, null);
            await TG.text(chatId, `Гаразд, зв'язок із твоїм диском скинуто.`, { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }

        if (text === "/drive_debug") {
          await safe(async () => {
            const t = await getUserTokens(env, userId);
            if (!t) {
              await TG.text(chatId, "🔴 Токени: не знайдено. Спочатку /link_drive", { token: env.BOT_TOKEN });
              return;
            }
            const expStr = t.expiry ? new Date(t.expiry * 1000).toISOString() : "невідомо";
            const hasRefresh = t.refresh_token ? "так" : "ні";
            await TG.text(chatId, `🩺 Debug:
• access_token: ${t.access_token ? "є" : "нема"}
• refresh_token: ${hasRefresh}
• expiry: ${expStr}`, { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }

        if (text === "/drive_on") {
          await safe(async () => {
            await setDriveMode(env, userId, true);
            await TG.text(chatId, "📁 Режим диска: ON\nНадсилай медіа — збережу на твій Google Drive.\nКоманда: /drive_off — щоб вимкнути.", { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }

        if (text === "/drive_off") {
          await safe(async () => {
            await setDriveMode(env, userId, false);
            await TG.text(chatId, "📁 Режим диска: OFF", { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }

        if (text === "/drive_status") {
          await safe(async () => {
            const on = await getDriveMode(env, userId);
            await TG.text(chatId, `📁 Режим диска: ${on ? "ON" : "OFF"}`, { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }

        if (text === "/my_files") {
          await safe(async () => {
            const files = await userListFiles(env, userId);
            const names = (files.files||[]).map(f=>`• ${f.name}`).join("\n") || "порожньо";
            await TG.text(chatId, `Твої файли:\n${names}`, { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }

        if (text.startsWith("/save_url")) {
          await safe(async () => {
            const parts = text.split(/\s+/);
            const fileUrl = parts[1];
            const name = parts.slice(2).join(" ") || "from_telegram.bin";
            if(!fileUrl){
              await TG.text(chatId, "Використання: /save_url <url> <опц.назва>", { token: env.BOT_TOKEN });
              return;
            }
            const f = await userSaveUrl(env, userId, fileUrl, name);
            await TG.text(chatId, `✅ Збережено: ${f.name}`, { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }

        if (text === "/save") {
          await safe(async () => {
            const reply = msg.reply_to_message;
            if (!reply) {
              await TG.text(chatId, "Використання: відповісти командою /save на фото/відео/документ, щоб зберегти в Google Drive.", { token: env.BOT_TOKEN });
              return;
            }
            const handled = await handleIncomingMedia(env, chatId, userId, reply);
            if (!handled) {
              await TG.text(chatId, "Тут немає підтримуваного вкладення. Спробуй відповісти на фото/відео/документ/аудіо/voice.", { token: env.BOT_TOKEN });
            }
          });
          return json({ok:true});
        }

        if (text === "/ping") {
          await safe(async () => {
            await TG.text(chatId, "🔔 Pong! Я на зв'язку.", { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }

        // ---- Якщо режим ON — пробуємо зберегти будь-який медіаконтент ----
        try {
          const mode = await getDriveMode(env, userId);
          if (mode) {
            const handled = await handleIncomingMedia(env, chatId, userId, msg);
            if (handled) return json({ ok:true });
          }
        } catch (mediaErr) {
          console.log("Media save (mode) error:", mediaErr);
          try { await TG.text(chatId, `❌ Не вдалось зберегти вкладення: ${String(mediaErr)}`, { token: env.BOT_TOKEN }); } catch {}
          return json({ ok:true });
        }

        // Дефолт, щоб завжди була відповідь
        await safe(async () => {
          await TG.text(chatId, "Команда не впізнана. Спробуй /start", { token: env.BOT_TOKEN });
        });
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
      console.log("Top-level error:", e);
      return json({ ok:false, error:String(e) }, 500);
    }
  }
};