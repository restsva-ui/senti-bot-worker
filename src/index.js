// src/index.js
import { drivePing, driveList, saveUrlToDrive, appendToChecklist, getAccessToken } from "./lib/drive.js";
import { TG } from "./lib/tg.js";
import { getUserTokens, putUserTokens, userListFiles, userSaveUrl } from "./lib/userDrive.js";

const ADMIN = (env, userId) => String(userId) === String(env.TELEGRAM_ADMIN_ID);

function html(s){ return new Response(s, {headers:{ "content-type":"text/html; charset=utf-8" }}) }
function json(o, status=200){ return new Response(JSON.stringify(o,null,2), {status, headers:{ "content-type":"application/json" }}) }

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    try {
      // ---- Health & helpers ----
      if (p === "/") return html("Senti Worker Active");
      if (p === "/health") return json({ ok:true, service: env.SERVICE_HOST });

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
        const r = await TG.deleteWebhook(env.BOT_TOKEN);
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

      // 1) GET /webhook — ручна перевірка
      if (p === "/webhook" && req.method !== "POST") {
        return json({ ok:true, note:"webhook alive (GET)" });
      }

      // 2) POST /webhook — прийом апдейтів із перевіркою секрету
      if (p === "/webhook" && req.method === "POST") {
        // Перевірка секрету (якщо заданий у env)
        const sec = req.headers.get("x-telegram-bot-api-secret-token");
        if (env.TG_WEBHOOK_SECRET && sec !== env.TG_WEBHOOK_SECRET) {
          console.log("Webhook: wrong secret", sec);
          return json({ ok:false, error:"unauthorized" }, 401);
        }

        // Приймаємо та логуємо апдейт
        let update;
        try {
          update = await req.json();
          console.log("TG update:", JSON.stringify(update));
        } catch (e) {
          console.log("Webhook parse error:", e);
          return json({ ok:false }, 400);
        }

        const msg = update.message || update.edited_message || update.channel_post;
        if (!msg) return json({ok:true}); // нічого відповідати

        const chatId = msg.chat.id;
        const userId = msg.from?.id;
        const text = (msg.text || "").trim();

        // командне меню
        if (text === "/start") {
          await TG.text(chatId,
`Привіт! Я Senti 🤖
Команди:
• /admin — адмін-меню (тільки для власника)
• /link_drive — прив'язати мій Google Drive
• /my_files — мої файли з диску
• /save_url <url> <name> — зберегти файл за URL до мого диску`, { token: env.BOT_TOKEN });
          return json({ok:true});
        }

        if (text === "/admin") {
          if (!ADMIN(env, userId)) {
            await TG.text(chatId, "⛔ Лише для адміна.", { token: env.BOT_TOKEN });
            return json({ok:true});
          }
          await TG.text(chatId,
`Адмін меню:
• /admin_ping — ping диска
• /admin_list — список файлів (адмін-диск)
• /admin_checklist <рядок> — допис у чеклист
• /admin_setwebhook — виставити вебхук`, { token: env.BOT_TOKEN });
          return json({ok:true});
        }

        if (text.startsWith("/admin_ping")) {
          if (!ADMIN(env, userId)) return json({ok:true});
          try {
            const r = await drivePing(env);
            await TG.text(chatId, `✅ Admin Drive OK. filesCount: ${r.filesCount}`, { token: env.BOT_TOKEN });
          } catch(e) {
            await TG.text(chatId, `❌ ${e}`, { token: env.BOT_TOKEN });
          }
          return json({ok:true});
        }

        if (text.startsWith("/admin_list")) {
          if (!ADMIN(env, userId)) return json({ok:true});
          const token = await getAccessToken(env);
          const files = await driveList(env, token);
          const names = (files.files||[]).map(f=>`• ${f.name} (${f.id})`).join("\n") || "порожньо";
          await TG.text(chatId, `Адмін диск:\n${names}`, { token: env.BOT_TOKEN });
          return json({ok:true});
        }

        if (text.startsWith("/admin_checklist")) {
          if (!ADMIN(env, userId)) return json({ok:true});
          const line = text.replace("/admin_checklist","").trim() || `tick ${new Date().toISOString()}`;
          const token = await getAccessToken(env);
          await appendToChecklist(env, token, line);
          await TG.text(chatId, `✅ Додано: ${line}`, { token: env.BOT_TOKEN });
          return json({ok:true});
        }

        if (text.startsWith("/admin_setwebhook")) {
          if (!ADMIN(env, userId)) return json({ok:true});
          const target = `https://${env.SERVICE_HOST}/webhook`;
          await TG.setWebhook(env.BOT_TOKEN, target, env.TG_WEBHOOK_SECRET);
          await TG.text(chatId, `✅ Вебхук → ${target}`, { token: env.BOT_TOKEN });
          return json({ok:true});
        }

        // ---- user drive commands ----
        if (text === "/link_drive") {
          const authUrl = `https://${env.SERVICE_HOST}/auth/start?u=${userId}`;
          await TG.text(chatId, `Перейди за посиланням і дозволь доступ до свого Google Drive (режим *drive.file*):\n${authUrl}`, { token: env.BOT_TOKEN });
          return json({ok:true});
        }

        if (text === "/unlink_drive") {
          await putUserTokens(env, userId, null); // перезапишемо null
          await TG.text(chatId, `Гаразд, зв'язок із твоїм диском скинуто.`, { token: env.BOT_TOKEN });
          return json({ok:true});
        }

        if (text === "/my_files") {
          try {
            const files = await userListFiles(env, userId);
            const names = (files.files||[]).map(f=>`• ${f.name}`).join("\n") || "порожньо";
            await TG.text(chatId, `Твої файли:\n${names}`, { token: env.BOT_TOKEN });
          } catch(e) {
            const msgErr = String(e).includes("not_linked")
              ? "Спочатку /link_drive"
              : `Помилка: ${e}`;
            await TG.text(chatId, msgErr, { token: env.BOT_TOKEN });
          }
          return json({ok:true});
        }

        if (text.startsWith("/save_url")) {
          const parts = text.split(/\s+/);
          const fileUrl = parts[1];
          const name = parts.slice(2).join(" ") || "from_telegram.bin";
          if(!fileUrl){
            await TG.text(chatId, "Використання: /save_url <url> <опц.назва>", { token: env.BOT_TOKEN });
            return json({ok:true});
          }
          try{
            const f = await userSaveUrl(env, userId, fileUrl, name);
            await TG.text(chatId, `✅ Збережено: ${f.name}`, { token: env.BOT_TOKEN });
          }catch(e){
            const msgErr = String(e).includes("not_linked")
              ? "Спочатку /link_drive"
              : `Помилка: ${e}`;
            await TG.text(chatId, msgErr, { token: env.BOT_TOKEN });
          }
          return json({ok:true});
        }

        // echo на інші
        return json({ok:true});
      }

      // ---- test TG send after OAuth ----
      if (p === "/tg/test") {
        const u = url.searchParams.get("u");
        await TG.text(u, "Senti тут. Все працює ✅", { token: env.BOT_TOKEN });
        return json({ ok:true });
      }

      return json({ ok:false, error:"Not found" }, 404);
    } catch (e) {
      return json({ ok:false, error:String(e) }, 500);
    }
  }
};