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

// === OAuth helpers ===
function buildGoogleOAuthUrl(env) {
  const clientId = env.GOOGLE_CLIENT_ID;
  const redirectUri = "https://senti-bot-worker.restsva.workers.dev/auth";
  const scope = "https://www.googleapis.com/auth/drive.file"; // без encode
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

async function exchangeCodeForTokens(code, env) {
  const redirectUri = "https://senti-bot-worker.restsva.workers.dev/auth";
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Token exchange failed: ${r.status} ${t}`);
  }
  return r.json(); // { access_token, expires_in, refresh_token?, scope, token_type }
}

async function storeTokens(env, data) {
  const prevRaw = await env.OAUTH_KV.get("google_tokens");
  const prev = prevRaw ? JSON.parse(prevRaw) : {};
  const merged = { ...prev, ...data, saved_at: Date.now() };
  await env.OAUTH_KV.put("google_tokens", JSON.stringify(merged));
  return merged;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // === Панель ===
    if (path === "/panel") {
      const oauthUrl = buildGoogleOAuthUrl(env);
      const tokensRaw = await env.OAUTH_KV.get("google_tokens");
      const tokens = tokensRaw ? JSON.parse(tokensRaw) : null;

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

            <h3>Статус токенів</h3>
            <pre style="white-space:pre-wrap;background:#111;padding:12px;border-radius:8px">
${tokens ? JSON.stringify({ has_refresh: !!tokens.refresh_token, saved_at: tokens.saved_at }, null, 2) : "немає збережених токенів"}
            </pre>

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

    // === OAuth redirect ===
    if (path === "/auth") {
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      if (error) return htmlResponse(`<h3>OAuth error</h3><pre>${error}</pre>`, 400);

      if (!code) {
        const saved = await env.OAUTH_KV.get("google_tokens");
        return htmlResponse(`
          <html><body style="font-family:system-ui;background:#0b0b0b;color:#eee;padding:24px">
            <h2>OAuth статус</h2>
            <pre style="white-space:pre-wrap;background:#111;padding:12px;border-radius:8px">
${saved ? saved : "⚠️ Токенів ще нема. Перейдіть у /panel і натисніть Авторизувати."}
            </pre>
            <a style="color:#00bfa5" href="/panel">⬅ Назад до панелі</a>
          </body></html>
        `);
      }

      try {
        const tokens = await exchangeCodeForTokens(code, env);
        const saved = await storeTokens(env, tokens);

        return htmlResponse(`
          <html><body style="font-family:system-ui;background:#0b0b0b;color:#eee;padding:24px">
            <h2>✅ Токени збережено</h2>
            <p>Отримано і збережено access/refresh токени.</p>
            <pre style="white-space:pre-wrap;background:#111;padding:12px;border-radius:8px">${JSON.stringify(saved, null, 2)}</pre>
            <p><a style="color:#00bfa5" href="/panel">⬅ Назад до панелі</a></p>
          </body></html>
        `);
      } catch (e) {
        return htmlResponse(`<h3>Помилка обміну токенів</h3><pre>${String(e.message || e)}</pre>`, 500);
      }
    }

    // === Telegram webhook ===
    if (path === "/webhook" && request.method === "POST") {
      return await webhook(request, env, ctx);
    }

    // === Health ===
    if (path === "/ping") return textResponse("pong 🟢");

    // === Google Drive API тестові ===
    if (path === "/gdrive/ping" && request.method === "GET") {
      if (!auth(url, env)) return textResponse("forbidden", 403);
      try {
        await drivePing(env);
        return jsonResponse({ ok: true, msg: "Drive OK" });
      } catch (e) {
        return jsonResponse({ ok: false, error: String(e?.message || e) }, 500);
      }
    }

    if (path === "/gdrive/list" && request.method === "GET") {
      if (!auth(url, env)) return textResponse("forbidden", 403);
      try {
        const files = await driveList(env, 10);
        return jsonResponse({ ok: true, files });
      } catch (e) {
        return jsonResponse({ ok: false, error: String(e?.message || e) }, 500);
      }
    }

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