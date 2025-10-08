// src/index.js
import {
  drivePing,
  driveList,
  saveUrlToDrive,
  appendToChecklist,
  getAccessToken
} from "./lib/drive.js";
import { TG } from "./lib/tg.js";
import { getUserTokens, putUserTokens, userListFiles, userSaveUrl } from "./lib/userDrive.js";

const ADMIN = (env, userId) => String(userId) === String(env.TELEGRAM_ADMIN_ID);

function html(s){ return new Response(s, {headers:{ "content-type":"text/html; charset=utf-8" }}) }
function json(o, status=200){ return new Response(JSON.stringify(o,null,2), {status, headers:{ "content-type":"application/json" }}) }

// Формуємо зручний лінк на файл у Drive (приватний, видимий власнику)
const driveLink = (id) => `https://drive.google.com/file/d/${id}/view?usp=drivesdk`;

// Витяг посилання на файл Telegram
async function getTelegramFileLink(botToken, fileId) {
  const info = await TG.api(botToken, "getFile", { file_id: fileId });
  const path = info?.result?.file_path;
  if (!path) throw new Error("Telegram: file_path not found");
  return `https://api.telegram.org/file/bot${botToken}/${path}`;
}

// Обробка та збереження вкладення з повідомлення
async function handleIncomingMedia(env, chatId, userId, msg) {
  // Визначаємо тип і дістаємо file_id + назву
  let fileId = null;
  let niceName = null;

  if (msg.document) {
    fileId = msg.document.file_id;
    niceName = msg.document.file_name || "document.bin";
  } else if (msg.photo?.length) {
    // Беремо найбільше фото
    const largest = msg.photo[msg.photo.length - 1];
    fileId = largest.file_id;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    niceName = `photo_${ts}.jpg`;
  } else if (msg.video) {
    fileId = msg.video.file_id;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    niceName = msg.video.file_name || `video_${ts}.mp4`;
  } else if (msg.audio) {
    fileId = msg.audio.file_id;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    niceName = msg.audio.file_name || `audio_${ts}.mp3`;
  } else if (msg.voice) {
    fileId = msg.voice.file_id;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    niceName = `voice_${ts}.ogg`;
  } else if (msg.animation) {
    fileId = msg.animation.file_id;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    niceName = msg.animation.file_name || `animation_${ts}.mp4`;
  }

  if (!fileId) return false; // не медіа — нехай командний обробник працює далі

  // Отримуємо прямий URL до файла в Telegram і зберігаємо в Drive користувача
  const tgFileUrl = await getTelegramFileLink(env.BOT_TOKEN, fileId);
  const saved = await userSaveUrl(env, userId, tgFileUrl, niceName);

  // Відповідаємо з лінком на файл у Drive
  const url = saved?.id ? driveLink(saved.id) : null;
  const name = saved?.name || niceName;
  const text =
    url
      ? `✅ Збережено: *${name}*\n🔗 ${url}`
      : `✅ Збережено: *${name}*`;
  await TG.text(chatId, text, { token: env.BOT_TOKEN, parse_mode: "Markdown" });

  return true;
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

      // POST /webhook — прийом апдейтів
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

        // спроба перехопити й зберегти вкладення до розбору команд
        try {
          const handled = await handleIncomingMedia(env, chatId, userId, msg);
          if (handled) return json({ ok:true });
        } catch (mediaErr) {
          console.log("Media save error:", mediaErr);
          try {
            await TG.text(chatId, `❌ Не вдалось зберегти вкладення: ${String(mediaErr)}`, { token: env.BOT_TOKEN });
          } catch {}
          return json({ ok:true });
        }

        // обгортка: будь-яка помилка піде в чат, а не «в тишу»
        const safe = async (fn) => {
          try { await fn(); }
          catch (e) {
            console.log("Handler error:", e);
            try {
              await TG.text(chatId, `❌ Помилка: ${String(e)}`, { token: env.BOT_TOKEN });
            } catch (e2) {
              console.log("Send error:", e2);
            }
          }
        };

        // ---- Команди ----
        if (text === "/start") {
          await safe(async () => {
            await TG.text(chatId,
`Привіт! Я Senti 🤖
Команди:
• /admin — адмін-меню (тільки для власника)
• /link_drive — прив'язати мій Google Drive
• /my_files — мої файли з диску
• /save_url <url> <name> — зберегти файл за URL до мого диску
• /drive_debug — діагностика OAuth
• /ping — перевірити, що бот живий`, { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }

        if (text === "/admin") {
          await safe(async () => {
            if (!ADMIN(env, userId)) {
              await TG.text(chatId, "⛔ Лише для адміна.", { token: env.BOT_TOKEN });
              return;
            }
            await TG.text(chatId,
`Адмін меню:
• /admin_ping — ping диска
• /admin_list — список файлів (адмін-диск)
• /admin_checklist <рядок> — допис у чеклист
• /admin_setwebhook — виставити вебхук
• /admin_refreshcheck — ручний рефреш та перевірка`, { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }

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
              if (!arr.length) {
                await TG.text(chatId, "📁 Диск порожній.", { token: env.BOT_TOKEN });
              } else {
                let msgOut = "Адмін диск:\n";
                msgOut += arr.map(f => `• ${f.name} (${f.id})`).join("\n");
                await TG.text(chatId, msgOut, { token: env.BOT_TOKEN });
              }
              try {
                await appendToChecklist(env, token, `admin_list OK ${new Date().toISOString()}`);
              } catch (e) {
                console.log("Checklist write failed (admin_list):", e);
              }
            };

            try {
              await once();
            } catch (e) {
              const s = String(e || "");
              if (s.includes("invalid_grant") || s.includes("Refresh 400")) {
                try { await once(); }
                catch (e2) { throw e2; }
              } else {
                throw e;
              }
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
              await TG.text(chatId, `✅ Refresh OK (отримано access_token).`, { token: env.BOT_TOKEN });
            } catch (e) {
              await TG.text(chatId, `❌ Refresh failed: ${String(e)}`, { token: env.BOT_TOKEN });
            }
          });
          return json({ok:true});
        }

        // ---- user drive commands ----
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
            const url = f?.id ? driveLink(f.id) : null;
            const msg = url
              ? `✅ Збережено: *${f.name || name}*\n🔗 ${url}`
              : `✅ Збережено: *${f.name || name}*`;
            await TG.text(chatId, msg, { token: env.BOT_TOKEN, parse_mode: "Markdown" });
          });
          return json({ok:true});
        }

        if (text === "/ping") {
          await safe(async () => {
            await TG.text(chatId, "🔔 Pong! Я на зв'язку.", { token: env.BOT_TOKEN });
          });
          return json({ok:true});
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