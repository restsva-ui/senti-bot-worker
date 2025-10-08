// src/index.js
import {
  drivePing,
  driveList,
  saveUrlToDrive,
  appendToChecklist,
  getAccessToken
} from "./lib/drive.js";
import { TG } from "./lib/tg.js";
import {
  getUserTokens,
  putUserTokens,
  userListFiles,
  userSaveUrl
} from "./lib/userDrive.js";

const ADMIN = (env, userId) => String(userId) === String(env.TELEGRAM_ADMIN_ID);

function html(s) {
  return new Response(s, { headers: { "content-type": "text/html; charset=utf-8" } });
}
function json(o, status = 200) {
  return new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { "content-type": "application/json" }
  });
}

// ---------- Helpers for media saving ----------
function tsName(prefix, ext) {
  const iso = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}_${iso}.${ext}`;
}

/**
 * Витягує найкраще доступне вкладення з повідомлення Telegram
 * і повертає { file_id, name, kind } або null, якщо вкладень нема.
 */
function extractAttachmentMeta(msg) {
  // document
  if (msg.document) {
    return {
      file_id: msg.document.file_id,
      name: msg.document.file_name || tsName("document", "bin"),
      kind: "document"
    };
  }
  // photo (масив розмірів; беремо найбільше)
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const ph = msg.photo[msg.photo.length - 1];
    return {
      file_id: ph.file_id,
      name: tsName("photo", "jpg"),
      kind: "photo"
    };
  }
  // video
  if (msg.video) {
    return {
      file_id: msg.video.file_id,
      name: msg.video.file_name || tsName("video", "mp4"),
      kind: "video"
    };
    }
  // audio
  if (msg.audio) {
    const base =
      msg.audio.file_name ||
      (msg.audio.title ? `${msg.audio.title}.mp3` : tsName("audio", "mp3"));
    return { file_id: msg.audio.file_id, name: base, kind: "audio" };
  }
  // voice (ogg/opus)
  if (msg.voice) {
    return {
      file_id: msg.voice.file_id,
      name: tsName("voice", "ogg"),
      kind: "voice"
    };
  }
  // sticker (webp/webm)
  if (msg.sticker) {
    const ext = msg.sticker.is_video ? "webm" : "webp";
    return {
      file_id: msg.sticker.file_id,
      name: tsName("sticker", ext),
      kind: "sticker"
    };
  }
  return null;
}

/**
 * Зберігає вкладення у Drive користувача.
 * captionName (якщо є) — вища пріоритетність над автоіменем.
 */
async function saveIncomingAttachment(env, chatId, userId, msg, captionName) {
  // перевірка токенів користувача (щоб показати дружню підказку)
  const t = await getUserTokens(env, userId);
  if (!t) {
    await TG.text(
      chatId,
      "Спершу треба прив'язати Google Drive: /link_drive",
      { token: env.BOT_TOKEN }
    );
    return;
  }

  const meta = extractAttachmentMeta(msg);
  if (!meta) {
    await TG.text(chatId, "Не знайдено вкладення для збереження.", {
      token: env.BOT_TOKEN
    });
    return;
  }

  // лінк на файл у Telegram CDN
  const fileUrl = await TG.getFileLink(env.BOT_TOKEN, meta.file_id);
  const finalName =
    (captionName && captionName.trim()) ? captionName.trim() : meta.name;

  const saved = await userSaveUrl(env, userId, fileUrl, finalName);
  await TG.text(chatId, `✅ Збережено: ${saved.name}`, { token: env.BOT_TOKEN });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    try {
      // ---- Health & helpers ----
      if (p === "/") return html("Senti Worker Active");
      if (p === "/health") return json({ ok: true, service: env.SERVICE_HOST });

      // ---- Telegram helpers ----
      if (p === "/tg/get-webhook") {
        const r = await TG.getWebhook(env.BOT_TOKEN);
        return new Response(await r.text(), {
          headers: { "content-type": "application/json" }
        });
      }

      if (p === "/tg/set-webhook") {
        const target = `https://${env.SERVICE_HOST}/webhook`;
        const r = await TG.setWebhook(env.BOT_TOKEN, target, env.TG_WEBHOOK_SECRET);
        return new Response(await r.text(), {
          headers: { "content-type": "application/json" }
        });
      }

      if (p === "/tg/del-webhook") {
        const r =
          (await TG.deleteWebhook?.(env.BOT_TOKEN)) ||
          (await fetch(
            `https://api.telegram.org/bot${env.BOT_TOKEN}/deleteWebhook`
          ));
        return new Response(await r.text(), {
          headers: { "content-type": "application/json" }
        });
      }

      // ---- Admin Drive quick checks ----
      if (p === "/gdrive/ping") {
        try {
          const token = await getAccessToken(env);
          const files = await driveList(env, token);
          return json({ ok: true, files: files.files || [] });
        } catch (e) {
          return json({ ok: false, error: String(e) }, 500);
        }
      }

      if (p === "/gdrive/save") {
        const token = await getAccessToken(env);
        const fileUrl = url.searchParams.get("url");
        const name = url.searchParams.get("name") || "from_web.md";
        const file = await saveUrlToDrive(env, token, fileUrl, name);
        return json({ ok: true, file });
      }

      if (p === "/gdrive/checklist") {
        const token = await getAccessToken(env);
        const line =
          url.searchParams.get("line") ||
          `tick ${new Date().toISOString()}`;
        await appendToChecklist(env, token, line);
        return json({ ok: true });
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
        const state = JSON.parse(atob(url.searchParams.get("state") || "e30="));
        const code = url.searchParams.get("code");
        const redirect_uri = `https://${env.SERVICE_HOST}/auth/cb`;
        const body = new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri,
          grant_type: "authorization_code"
        });
        const r = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body
        });
        const d = await r.json();
        if (!r.ok) return html(`<pre>${JSON.stringify(d, null, 2)}</pre>`);
        const tokens = {
          access_token: d.access_token,
          refresh_token: d.refresh_token,
          expiry:
            Math.floor(Date.now() / 1000) + (d.expires_in || 3600) - 60
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
        return json({ ok: true, note: "webhook alive (GET)" });
      }

      // POST /webhook — прийом апдейтів (із перевіркою секрету, якщо заданий)
      if (p === "/webhook" && req.method === "POST") {
        const sec = req.headers.get("x-telegram-bot-api-secret-token");
        if (env.TG_WEBHOOK_SECRET && sec !== env.TG_WEBHOOK_SECRET) {
          console.log("Webhook: wrong secret", sec);
          return json({ ok: false, error: "unauthorized" }, 401);
        }

        let update;
        try {
          update = await req.json();
          console.log("TG update:", JSON.stringify(update).slice(0, 2000));
        } catch (e) {
          console.log("Webhook parse error:", e);
          return json({ ok: false }, 400);
        }

        const msg =
          update.message ||
          update.edited_message ||
          update.channel_post ||
          update.callback_query?.message;
        const textRaw =
          update.message?.text ||
          update.edited_message?.text ||
          update.callback_query?.data ||
          msg?.caption || // важливо: підхоплюємо caption
          "";
        if (!msg) return json({ ok: true });

        const chatId = msg.chat.id;
        const userId = msg.from?.id;
        const text = (textRaw || "").trim();

        const safe = async (fn) => {
          try {
            await fn();
          } catch (e) {
            console.log("Handler error:", e);
            try {
              await TG.text(chatId, `❌ Помилка: ${String(e)}`, {
                token: env.BOT_TOKEN
              });
            } catch (e2) {
              console.log("Send error:", e2);
            }
          }
        };

        // ----- АВТОЗБЕРЕЖЕННЯ ВКЛАДЕНЬ -----
        const hasAttachment =
          !!(msg.document || msg.photo || msg.video || msg.audio || msg.voice || msg.sticker);

        // Якщо є вкладення і це не явна команда (або команда /save)
        if (hasAttachment && (!text.startsWith("/") || text.startsWith("/save"))) {
          await safe(async () => {
            const captionName = text.startsWith("/") ? msg.caption?.replace(/^\/save\s*/i, "") : text;
            await saveIncomingAttachment(env, chatId, userId, msg, captionName);
          });
          return json({ ok: true });
        }

        // ---- Команди ----
        if (text === "/start") {
          await safe(async () => {
            await TG.text(
              chatId,
`Привіт! Я Senti 🤖
Команди:
• /admin — адмін-меню (тільки для власника)
• /link_drive — прив'язати мій Google Drive
• /my_files — мої файли з диску
• /save_url <url> <name> — зберегти файл за URL до мого диску
• Просто надішли мені файл/фото/відео — я збережу на диск
• /drive_debug — діагностика OAuth
• /ping — перевірити, що бот живий`, { token: env.BOT_TOKEN }
            );
          });
          return json({ ok: true });
        }

        if (text === "/admin") {
          await safe(async () => {
            if (!ADMIN(env, userId)) {
              await TG.text(chatId, "⛔ Лише для адміна.", {
                token: env.BOT_TOKEN
              });
              return;
            }
            await TG.text(
              chatId,
`Адмін меню:
• /admin_ping — ping диска
• /admin_list — список файлів (адмін-диск)
• /admin_checklist <рядок> — допис у чеклист
• /admin_setwebhook — виставити вебхук
• /admin_refreshcheck — ручний рефреш та перевірка`,
              { token: env.BOT_TOKEN }
            );
          });
          return json({ ok: true });
        }

        if (text.startsWith("/admin_ping")) {
          await safe(async () => {
            if (!ADMIN(env, userId)) return;
            const r = await drivePing(env);
            await TG.text(
              chatId,
              `✅ Admin Drive OK. filesCount: ${r.filesCount}`,
              { token: env.BOT_TOKEN }
            );
          });
          return json({ ok: true });
        }

        if (text.startsWith("/admin_list")) {
          await safe(async () => {
            if (!ADMIN(env, userId)) return;

            const once = async () => {
              const token = await getAccessToken(env);
              const files = await driveList(env, token);
              const arr = files.files || [];
              if (!arr.length) {
                await TG.text(chatId, "📁 Диск порожній.", {
                  token: env.BOT_TOKEN
                });
              } else {
                let msgOut = "Адмін диск:\n";
                msgOut += arr.map((f) => `• ${f.name} (${f.id})`).join("\n");
                await TG.text(chatId, msgOut, { token: env.BOT_TOKEN });
              }
              try {
                await appendToChecklist(
                  env,
                  token,
                  `admin_list OK ${new Date().toISOString()}`
                );
              } catch (e) {
                console.log("Checklist write failed (admin_list):", e);
              }
            };

            try {
              await once();
            } catch (e) {
              const s = String(e || "");
              if (s.includes("invalid_grant") || s.includes("Refresh 400")) {
                try {
                  await once();
                } catch (e2) {
                  throw e2;
                }
              } else {
                throw e;
              }
            }
          });
          return json({ ok: true });
        }

        if (text.startsWith("/admin_checklist")) {
          await safe(async () => {
            if (!ADMIN(env, userId)) return;
            const line =
              text.replace("/admin_checklist", "").trim() ||
              `tick ${new Date().toISOString()}`;
            const token = await getAccessToken(env);
            await appendToChecklist(env, token, line);
            await TG.text(chatId, `✅ Додано: ${line}`, {
              token: env.BOT_TOKEN
            });
          });
          return json({ ok: true });
        }

        if (text.startsWith("/admin_setwebhook")) {
          await safe(async () => {
            if (!ADMIN(env, userId)) return;
            const target = `https://${env.SERVICE_HOST}/webhook`;
            await TG.setWebhook(env.BOT_TOKEN, target, env.TG_WEBHOOK_SECRET);
            await TG.text(
              chatId,
              `✅ Вебхук → ${target}${
                env.TG_WEBHOOK_SECRET ? " (секрет застосовано)" : ""
              }`,
              { token: env.BOT_TOKEN }
            );
          });
          return json({ ok: true });
        }

        if (text.startsWith("/admin_refreshcheck")) {
          await safe(async () => {
            if (!ADMIN(env, userId)) return;
            try {
              const tok = await getAccessToken(env);
              if (tok) {
                await TG.text(chatId, `✅ Refresh OK (отримано access_token).`, {
                  token: env.BOT_TOKEN
                });
              }
            } catch (e) {
              await TG.text(chatId, `❌ Refresh failed: ${String(e)}`, {
                token: env.BOT_TOKEN
              });
            }
          });
          return json({ ok: true });
        }

        // ---- user drive commands ----
        if (text === "/link_drive") {
          await safe(async () => {
            const authUrl = `https://${env.SERVICE_HOST}/auth/start?u=${userId}`;
            await TG.text(
              chatId,
              `Перейди за посиланням і дозволь доступ до свого Google Drive (режим *drive.file*):\n${authUrl}`,
              { token: env.BOT_TOKEN }
            );
          });
          return json({ ok: true });
        }

        if (text === "/unlink_drive") {
          await safe(async () => {
            await putUserTokens(env, userId, null);
            await TG.text(chatId, `Гаразд, зв'язок із твоїм диском скинуто.`, {
              token: env.BOT_TOKEN
            });
          });
          return json({ ok: true });
        }

        if (text === "/drive_debug") {
          await safe(async () => {
            const t = await getUserTokens(env, userId);
            if (!t) {
              await TG.text(
                chatId,
                "🔴 Токени: не знайдено. Спочатку /link_drive",
                { token: env.BOT_TOKEN }
              );
              return;
            }
            const expStr = t.expiry
              ? new Date(t.expiry * 1000).toISOString()
              : "невідомо";
            const hasRefresh = t.refresh_token ? "так" : "ні";
            await TG.text(
              chatId,
              `🩺 Debug:
• access_token: ${t.access_token ? "є" : "нема"}
• refresh_token: ${hasRefresh}
• expiry: ${expStr}`,
              { token: env.BOT_TOKEN }
            );
          });
          return json({ ok: true });
        }

        if (text === "/my_files") {
          await safe(async () => {
            const files = await userListFiles(env, userId);
            const names =
              (files.files || []).map((f) => `• ${f.name}`).join("\n") ||
              "порожньо";
            await TG.text(chatId, `Твої файли:\n${names}`, {
              token: env.BOT_TOKEN
            });
          });
          return json({ ok: true });
        }

        if (text.startsWith("/save_url")) {
          await safe(async () => {
            const parts = text.split(/\s+/);
            const fileUrl = parts[1];
            const name = parts.slice(2).join(" ") || "from_telegram.bin";
            if (!fileUrl) {
              await TG.text(
                chatId,
                "Використання: /save_url <url> <опц.назва>",
                { token: env.BOT_TOKEN }
              );
              return;
            }
            const f = await userSaveUrl(env, userId, fileUrl, name);
            await TG.text(chatId, `✅ Збережено: ${f.name}`, {
              token: env.BOT_TOKEN
            });
          });
          return json({ ok: true });
        }

        if (text === "/ping") {
          await safe(async () => {
            await TG.text(chatId, "🔔 Pong! Я на зв'язку.", {
              token: env.BOT_TOKEN
            });
          });
          return json({ ok: true });
        }

        // Дефолт, щоб завжди була відповідь
        await safe(async () => {
          await TG.text(chatId, "Команда не впізнана. Спробуй /start", {
            token: env.BOT_TOKEN
          });
        });
        return json({ ok: true });
      }

      // ---- test TG send after OAuth ----
      if (p === "/tg/test") {
        const u = url.searchParams.get("u");
        await TG.text(u, "Senti тут. Все працює ✅", { token: env.BOT_TOKEN });
        return json({ ok: true });
      }

      // ---- 404 ----
      return json({ ok: false, error: "Not found" }, 404);
    } catch (e) {
      console.log("Top-level error:", e);
      return json({ ok: false, error: String(e) }, 500);
    }
  }
};