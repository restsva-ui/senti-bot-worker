// src/index.js
import { TG } from "./lib/tg.js";

// user Drive OAuth area
import { getUserTokens, putUserTokens, userListFiles, userSaveUrl } from "./lib/userDrive.js";

// KV checklist + audit
import {
  readChecklist,
  writeChecklist,
  appendChecklist,
  checklistHtml
} from "./lib/kvChecklist.js";
import { logHeartbeat, logDeploy } from "./lib/audit.js";

// KV repo ("міні-Git")
import {
  saveRepoArchive,
  listVersions,
  setActiveVersion,
  getActiveVersion,
  getArchiveBase64,
  deleteVersion,
  writeRepoFile,
  readRepoFile,
  listRepoFiles,
  setVersionStatus
} from "./lib/kvRepo.js";

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

// ---------------- HTML helpers (repo UI) ----------------
function repoHtmlPage({ versions=[], active="", secretParam="", fileView="", filePath="" } = {}) {
  const badge = (s) => s === "ok" ? "style='color:#0a0;background:#e9ffe9;padding:2px 8px;border-radius:12px'" :
                    s === "fail" ? "style='color:#a00;background:#ffe9e9;padding:2px 8px;border-radius:12px'" :
                                   "style='color:#555;background:#eee;padding:2px 8px;border-radius:12px'";
  const esc = (x) => String(x||"").replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  const host = "https://" + (globalThis.__SERVICE_HOST__ || "");
  return `<!doctype html>
<meta charset="utf-8">
<title>Senti Repo</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin:18px; line-height:1.45}
h2{margin:0 0 12px}
section{margin:18px 0}
table{border-collapse:collapse;width:100%}
td,th{border:1px solid #ddd;padding:8px}
tr:nth-child(even){background:#fafafa}
.badge{font-size:12px}
input,button,textarea{font:inherit}
textarea{width:100%;height:50vh}
.row{display:flex;gap:8px;flex-wrap:wrap}
</style>

<h2>🗂️ Senti Repo</h2>

<section>
  <h3>Завантажити ZIP</h3>
  <form method="POST" action="/admin/repo/upload?${secretParam}" enctype="multipart/form-data">
    <input type="file" name="zip" accept=".zip" required>
    <input type="text" name="comment" placeholder="Коментар (опц.)">
    <button type="submit">Завантажити</button>
  </form>
</section>

<section>
  <h3>Версії</h3>
  <table>
    <tr><th>Активна</th><th>ID</th><th>Назва</th><th>Статус</th><th>Коментар</th><th>Дії</th></tr>
    ${versions.map(v => `
      <tr>
        <td>${v.active ? "✅" : ""}</td>
        <td><code>${esc(v.id)}</code></td>
        <td>${esc(v.name||"")}</td>
        <td><span class="badge" ${badge(v.status||"unknown")}>${v.status||"unknown"}</span></td>
        <td>${esc(v.comment||"")}</td>
        <td class="row">
          <form method="POST" action="/admin/repo/switch?${secretParam}">
            <input type="hidden" name="id" value="${esc(v.id)}">
            <button type="submit">Зробити активною</button>
          </form>
          <form method="POST" action="/admin/repo/delete?${secretParam}" onsubmit="return confirm('Видалити версію?')">
            <input type="hidden" name="id" value="${esc(v.id)}">
            <button type="submit">Видалити</button>
          </form>
        </td>
      </tr>
    `).join("")}
  </table>
</section>

<section>
  <h3>Редактор файлу (current)</h3>
  <form method="GET" action="/admin/repo/html">
    <input type="hidden" name="s" value="${esc(new URLSearchParams(secretParam).get("s")||"")}">
    <input type="text" name="path" placeholder="наприклад: src/index.js" value="${esc(filePath||"")}">
    <button type="submit">Відкрити</button>
  </form>
  ${filePath ? `
  <form method="POST" action="/admin/repo/file?${secretParam}">
    <input type="hidden" name="path" value="${esc(filePath)}">
    <textarea name="content">${esc(fileView||"")}</textarea>
    <div class="row">
      <button type="submit">💾 Зберегти</button>
    </div>
  </form>` : ""}
</section>

<section>
  <h3>Корисне</h3>
  <ul>
    <li><a href="/admin/checklist/html?${secretParam}" target="_blank">Чеклист (HTML)</a></li>
    <li><a href="/admin/checklist?${secretParam}" target="_blank">Чеклист (JSON)</a></li>
  </ul>
</section>
`;
}

// ---------------- HTTP worker ----------------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    // для repoHtmlPage (віддати хост у шаблон)
    globalThis.__SERVICE_HOST__ = env.SERVICE_HOST || url.host;

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
        const status = (url.searchParams.get("status") || "").toLowerCase(); // ok|fail

        const line = await logDeploy(env, { source:"ci", commit, actor, deployId: depId });
        // Підсвітка статусу у маніфесті для активної версії
        const active = await getActiveVersion(env);
        if (active && (status === "ok" || status === "fail")) {
          await setVersionStatus(env, active, status);
        }
        return json({ ok:true, line, active, status: status || "unknown" });
      }

      // ---- Admin checklist HTML (захист секретом) ----
      if (p === "/admin/checklist/html") {
        const s = url.searchParams.get("s");
        if (env.WEBHOOK_SECRET && s !== env.WEBHOOK_SECRET) {
          return html("<h3>401</h3>");
        }

        if (req.method === "POST") {
          // приймаємо лише стандартну форму з нашої сторінки
          const ctype = req.headers.get("content-type") || "";
          if (!ctype.includes("application/x-www-form-urlencoded") && !ctype.includes("multipart/form-data")) {
            return json({ ok:false, error:"unsupported content-type" }, 415);
          }
          const form = await req.formData();
          const mode = (url.searchParams.get("mode") || "").toLowerCase();

          if (mode === "replace") {
            const full = form.get("full") ?? "";
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

      // ====== ADMIN REPO UI/API (захищено WEBHOOK_SECRET) ======
      if (p === "/admin/repo/html") {
        const s = url.searchParams.get("s");
        if (env.WEBHOOK_SECRET && s !== env.WEBHOOK_SECRET) return html("<h3>401</h3>");

        const secretParam = "s=" + encodeURIComponent(env.WEBHOOK_SECRET || "");
        const versions = await listVersions(env);

        // редактор файлу (GET ?path=...)
        const filePath = (url.searchParams.get("path") || "").trim();
        let fileView = "";
        if (filePath) {
          try { fileView = await readRepoFile(env, filePath); }
          catch { fileView = ""; }
        }
        return html(repoHtmlPage({ versions, active: await getActiveVersion(env), secretParam, fileView, filePath }));
      }

      // upload ZIP
      if (p === "/admin/repo/upload" && req.method === "POST") {
        const s = url.searchParams.get("s");
        if (env.WEBHOOK_SECRET && s !== env.WEBHOOK_SECRET) return json({ ok:false, error:"unauthorized" }, 401);
        const form = await req.formData();
        const zip = form.get("zip");
        const comment = form.get("comment") || "";
        if (!zip || typeof zip.arrayBuffer !== "function") return json({ ok:false, error:"zip required" }, 400);

        const { id, key, name } = await saveRepoArchive(env, zip, comment);
        await appendChecklist(env, `repo: uploaded ${name} (version=${id})`);

        // редірект назад у HTML
        return Response.redirect(`/admin/repo/html?s=${encodeURIComponent(env.WEBHOOK_SECRET||"")}`, 302);
      }

      // switch active
      if (p === "/admin/repo/switch" && req.method === "POST") {
        const s = url.searchParams.get("s");
        if (env.WEBHOOK_SECRET && s !== env.WEBHOOK_SECRET) return json({ ok:false, error:"unauthorized" }, 401);
        const form = await req.formData();
        const id = (form.get("id") || "").toString();
        if (!id) return json({ ok:false, error:"id required" }, 400);
        await setActiveVersion(env, id);
        await appendChecklist(env, `repo: switched active version to ${id}`);
        return Response.redirect(`/admin/repo/html?s=${encodeURIComponent(env.WEBHOOK_SECRET||"")}`, 302);
      }

      // delete version
      if (p === "/admin/repo/delete" && req.method === "POST") {
        const s = url.searchParams.get("s");
        if (env.WEBHOOK_SECRET && s !== env.WEBHOOK_SECRET) return json({ ok:false, error:"unauthorized" }, 401);
        const form = await req.formData();
        const id = (form.get("id") || "").toString();
        if (!id) return json({ ok:false, error:"id required" }, 400);
        const ok = await deleteVersion(env, id);
        if (ok) await appendChecklist(env, `repo: deleted version ${id}`);
        return Response.redirect(`/admin/repo/html?s=${encodeURIComponent(env.WEBHOOK_SECRET||"")}`, 302);
      }

      // save file (editor)
      if (p === "/admin/repo/file") {
        const s = url.searchParams.get("s");
        if (env.WEBHOOK_SECRET && s !== env.WEBHOOK_SECRET) return json({ ok:false, error:"unauthorized" }, 401);

        if (req.method === "POST") {
          const ctype = req.headers.get("content-type") || "";
          if (!ctype.includes("application/x-www-form-urlencoded") && !ctype.includes("multipart/form-data")) {
            return json({ ok:false, error:"unsupported content-type" }, 415);
          }
          const form = await req.formData();
          const path = (form.get("path") || "").toString().trim();
          const content = form.get("content") ?? "";
          if (!path) return json({ ok:false, error:"path required" }, 400);

          await writeRepoFile(env, path, String(content));
          await appendChecklist(env, `repo: updated file ${path}`);

          // повертаємо назад у редактор на цей самий файл
          const sp = `s=${encodeURIComponent(env.WEBHOOK_SECRET||"")}&path=${encodeURIComponent(path)}`;
          return Response.redirect(`/admin/repo/html?${sp}`, 302);
        }

        // GET: віддаємо JSON вміст файлу
        if (req.method === "GET") {
          const path = (url.searchParams.get("path") || "").trim();
          if (!path) return json({ ok:false, error:"path required" }, 400);
          const content = await readRepoFile(env, path);
          return json({ ok:true, path, content });
        }
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
• /admin_note_deploy — тестова деплой-нотатка
• Репозиторій (HTML): https://${env.SERVICE_HOST}/admin/repo/html?s=${env.WEBHOOK_SECRET||""}`,
              { token: env.BOT_TOKEN });
          });
          return json({ok:true});
        }

        // ------- ADMIN CMDS (KV) -------
        if (text === "/admin_check") {
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