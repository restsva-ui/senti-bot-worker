// src/index.js
// Прості роуты для OAuth і роботи з Drive

import {
  getAccessToken,
  drivePing,
  listFiles as driveList,
  saveUrlToDrive,
  appendToChecklist,
} from "./lib/drive.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function html(body, status = 200) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui,Segoe UI,Arial,sans-serif;padding:16px">${body}</body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

function buildRedirectUri(url) {
  const u = new URL(url);
  u.pathname = "/oauth2/callback";
  u.search = "";
  u.hash = "";
  return u.toString();
}

function buildAuthUrl(env, redirectUri) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "https://www.googleapis.com/auth/drive.file");
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  return u.toString();
}

async function exchangeCodeForTokens(env, code, redirectUri) {
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

  const d = await r.json();
  if (!r.ok) {
    throw new Error(`Auth ${r.status}: ${JSON.stringify(d)}`);
  }

  // збережемо в KV у форматі, який очікує lib/drive.js
  const expiry = Math.floor(Date.now() / 1000) + (d.expires_in || 3600) - 60;
  await env.OAUTH_KV.put(
    "google_oauth",
    JSON.stringify({
      access_token: d.access_token,
      refresh_token: d.refresh_token, // може бути undefined, якщо повторна згода
      expiry,
    })
  );

  return d;
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const { pathname, searchParams } = url;

      // --- кореневий пінг
      if (pathname === "/") {
        return new Response("Senti Worker Active", { status: 200 });
      }

      // --- старт OAuth
      if (pathname === "/auth") {
        const redirectUri = buildRedirectUri(request.url);
        const authUrl = buildAuthUrl(env, redirectUri);
        return Response.redirect(authUrl, 302);
      }

      // --- callback OAuth
      if (pathname === "/oauth2/callback") {
        const code = searchParams.get("code");
        if (!code) return html(`<h3>Немає code</h3>`, 400);

        try {
          await exchangeCodeForTokens(env, code, buildRedirectUri(request.url));
        } catch (e) {
          return html(
            `<h3>Помилка обміну токена</h3><pre>${String(e)}</pre>`,
            400
          );
        }

        // швидкі лінки
        const base = `${url.origin}`;
        return html(
          `<h2>✅ Редірект працює</h2>
           <p>Отримали та зберегли токени. Можеш перевірити:</p>
           <ul>
             <li><a href="${base}/gdrive/ping">/gdrive/ping</a></li>
             <li><a href="${base}/gdrive/list">/gdrive/list</a></li>
           </ul>`
        );
      }

      // --- GDrive: ping
      if (pathname === "/gdrive/ping") {
        try {
          const out = await drivePing(env);
          return json({ ok: true, ...out });
        } catch (e) {
          return json({ ok: false, error: String(e) }, 400);
        }
      }

      // --- GDrive: list у папці
      if (pathname === "/gdrive/list") {
        try {
          const token = await getAccessToken(env);
          const files = await driveList(env, token);
          return json({ ok: true, ...files });
        } catch (e) {
          return json({ ok: false, error: String(e) }, 400);
        }
      }

      // --- GDrive: зберегти файл із URL
      if (pathname === "/gdrive/save") {
        const fileUrl = searchParams.get("url");
        const name = searchParams.get("name") || "file.bin";
        if (!fileUrl) return json({ ok: false, error: "Missing ?url=" }, 400);
        try {
          const token = await getAccessToken(env);
          const res = await saveUrlToDrive(env, token, fileUrl, name);
          return json({ ok: true, file: res });
        } catch (e) {
          return json({ ok: false, error: String(e) }, 400);
        }
      }

      // --- GDrive: дописати в чекліст
      if (pathname === "/gdrive/checklist/add") {
        const line = searchParams.get("line");
        if (!line) return json({ ok: false, error: "Missing ?line=" }, 400);
        try {
          const token = await getAccessToken(env);
          await appendToChecklist(env, token, line);
          return json({ ok: true });
        } catch (e) {
          return json({ ok: false, error: String(e) }, 400);
        }
      }

      // якщо нічого не підходить
      return json({ ok: false, error: "Not found" }, 404);
    } catch (err) {
      return json({ ok: false, error: String(err) }, 500);
    }
  },
};