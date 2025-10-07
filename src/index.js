// src/index.js
import webhook from "./routes/webhook.js";
import { drivePing, driveSaveFromUrl, driveList, driveAppendLog } from "./lib/drive.js";

function textResponse(text, status = 200, type = "text/plain") {
  return new Response(text, { status, headers: { "content-type": type } });
}

function htmlResponse(html, status = 200) {
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function auth(url, env) {
  const key = url.searchParams.get("key");
  const ok = key && key === (env.WEBHOOK_SECRET ?? "");
  return ok;
}

// === OAuth helper: будуємо URL авторизації Google ===
function buildGoogleOAuthUrl(env) {
  const clientId = env.GOOGLE_CLIENT_ID; // має бути у Variables/Secrets
  const redirectUri = "https://senti-bot-worker.restsva.workers.dev/auth"; // УВАГА: restsva!
  const scope = encodeURIComponent("https://www.googleapis.com/auth/drive.file");
  const base = "https://accounts.google.com/o/oauth2/v2/auth";
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope,
  });
  return `${base}?${q.toString()}`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // === HTML тест-панель ===
    if (path === "/panel") {
      const oauthUrl = buildGoogleOAuthUrl(env);
      return htmlResponse(`
        <html>
          <head><meta charset="utf-8"><title>Senti Panel</title></head>
          <body style="font-family:system-ui;background:#0b0b0b;color:#eee;padding:32px">
            <h2>Senti Drive Link — Testing</h2>
            <p>Крок 1: авторизуй Google Drive через офіційний флоу.</p>
            <p>
              <a href="${oauthUrl}"
                 style="display:inline-block;margin:12px 0;padding:12px 18px;background:#00bfa5;color:#fff;text-decoration:none;border-radius:8px">
                 🔑 Авторизувати Google Drive
              </a>
            </p>
            <hr style="border:0;border-top:1px solid #2a2a2a;margin:24px 0" />
            <p>Швидкі тести (потрібен ?key=...):</p>
            <ul>
              <li><a style="color:#00bfa5" href="/gdrive/ping?key=${encodeURIComponent(env.WEBHOOK_SECRET || "")}">/gdrive/ping</a></li>
              <li><a style="color:#00bfa5" href="/gdrive/list?key=${encodeURIComponent(env.WEBHOOK_SECRET || "")}">/gdrive/list</a></li>
            </ul>
          </body>
        </html>
      `);
    }

    // === OAuth redirect handler (поки що показуємо code для перевірки) ===
    if (path === "/auth") {
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      if (error) {
        return htmlResponse(`<h3>OAuth error</h3><pre>${error}</pre>`, 400);
      }
      if (!code) {
        return htmlResponse(`<h3>Немає ?code=...</h3><p>Схоже, авторизацію не підтверджено.</p>`, 400);
      }
      return htmlResponse(`
        <html><body style="font-family:system-ui;background:#0b0b0b;color:#eee;padding:24px">
          <h2>✅ Редірект працює</h2>
          <p>Отримали <b>code</b> від Google:</p>
          <pre style="white-space:pre-wrap;background:#111;padding:12px;border-radius:8px">${code}</pre>
          <p>Далі обміняємо його на токени в наступному кроці.</p>
          <p><a style="color:#00bfa5" href="/panel">⬅ Назад до панелі</a></p>
        </body></html>
      `);
    }

    // === Telegram webhook ===
    if (path === "/webhook" && request.method === "POST") {
      return await webhook(request, env, ctx);
    }

    // === Health ===
    if (path === "/ping") {
      return textResponse("pong 🟢");
    }

    // === Google Drive: тести з телефона (GET з ?key=...) ===

    // 1) Перевірка доступності папки
    if (path === "/gdrive/ping" && request.method === "GET") {
      if (!auth(url, env)) return textResponse("forbidden", 403);
      try {
        await drivePing(env);
        return jsonResponse({ ok: true, msg: "Drive OK" });
      } catch (e) {
        return jsonResponse({ ok: false, error: String(e?.message || e) }, 500);
      }
    }

    // 2) Список останніх 10 файлів
    if (path === "/gdrive/list" && request.method === "GET") {
      if (!auth(url, env)) return textResponse("forbidden", 403);
      try {
        const files = await driveList(env, 10);
        return jsonResponse({ ok: true, files });
      } catch (e) {
        return jsonResponse({ ok: false, error: String(e?.message || e) }, 500);
      }
    }

    // 3) Зберегти файл за URL
    if (path === "/gdrive/save" && request.method === "GET") {
      if (!auth(url, env)) return textResponse("forbidden", 403);
      const fileUrl = url.searchParams.get("url");
      const name = url.searchParams.get("name") || "";
      if (!fileUrl) return jsonResponse({ ok: false, error: "missing url" }, 400);
      try {
        const res = await driveSaveFromUrl(env, fileUrl, name);
        return jsonResponse({ ok: true, saved: res });
      } catch (e) {
        return jsonResponse({ ok: false, error: String(e?.message || e) }, 500);
      }
    }

    // 4) Додати рядок у лог-файл (створює, якщо нема)
    //    /gdrive/log?key=...&msg=Hello%20world[&file=my_log.txt]
    if (path === "/gdrive/log" && request.method === "GET") {
      if (!auth(url, env)) return textResponse("forbidden", 403);
      const msg = url.searchParams.get("msg") || "";
      const file = url.searchParams.get("file") || "senti_logs.txt";
      if (!msg) return jsonResponse({ ok: false, error: "missing msg" }, 400);
      try {
        const res = await driveAppendLog(env, file, msg);
        return jsonResponse({ ok: true, result: res });
      } catch (e) {
        return jsonResponse({ ok: false, error: String(e?.message || e) }, 500);
      }
    }

    // === Default ===
    return textResponse("Senti Worker Active");
  },
};