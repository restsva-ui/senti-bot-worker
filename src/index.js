// src/index.js
import { Drive } from "./lib/drive.js";

const JSON_OK = (obj) =>
  new Response(JSON.stringify(obj, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const TEXT = (s, code = 200) =>
  new Response(s, { status: code, headers: { "content-type": "text/plain" } });

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // Проста перевірка живості
      if (path === "/" || path === "/status") {
        return TEXT("Senti Worker Active");
      }

      // ===== OAuth: старт авторизації =====
      if (path === "/auth") {
        const state = "senti1984";
        const params = new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID,
          redirect_uri: `${url.origin}/oauth2/callback`,
          response_type: "code",
          access_type: "offline",
          prompt: "consent",
          include_granted_scopes: "true",
          scope: "https://www.googleapis.com/auth/drive",
          state,
        });
        return Response.redirect(
          `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
          302
        );
      }

      // ===== OAuth: прийом коду та збереження токенів у KV =====
      if (path === "/oauth2/callback") {
        const code = url.searchParams.get("code");
        if (!code) return JSON_OK({ ok: false, error: "code missing" });

        // обмін на токени
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: `${url.origin}/oauth2/callback`,
            grant_type: "authorization_code",
          }),
        });

        const tokenJson = await tokenRes.json();
        if (!tokenRes.ok) {
          return JSON_OK({ ok: false, error: "token exchange failed", details: tokenJson });
        }
        // очікуємо refresh_token (важливо мати prompt=consent + access_type=offline)
        if (!tokenJson.refresh_token) {
          // інколи Google не повертає його, якщо раніше вже видали доступ — тому радимо очищати permissions.
          // але все одно збережемо, що маємо.
        }

        // Збереження в KV (один профіль — ключ 'google:oauth')
        const payload = {
          ...tokenJson,
          saved_at: Date.now(),
        };
        await env.OAUTH_KV.put("google:oauth", JSON.stringify(payload));

        return new Response(
          `<h3>✅ Редирект працює</h3>
           <p>Отримали та зберегли токени. Можеш перевірити:</p>
           <ul>
             <li><a href="/gdrive/ping?key=senti1984">/gdrive/ping</a></li>
             <li><a href="/gdrive/list?key=senti1984">/gdrive/list</a></li>
           </ul>`,
          { headers: { "content-type": "text/html; charset=utf-8" } }
        );
      }

      // ===== Тести Google Drive =====
      if (path === "/gdrive/ping") {
        const drive = new Drive(env);
        const ok = await drive.ping();
        return JSON_OK(ok);
      }

      if (path === "/gdrive/list") {
        const drive = new Drive(env);
        const files = await drive.listLatest(env.DRIVE_FOLDER_ID);
        return JSON_OK(files);
      }

      if (path === "/gdrive/save-from-url") {
        const src = url.searchParams.get("url");
        if (!src) return JSON_OK({ ok: false, error: "url missing" });
        const drive = new Drive(env);
        const res = await drive.saveFromUrl(src, env.DRIVE_FOLDER_ID);
        return JSON_OK(res);
      }

      // fallback
      return TEXT("Not found", 404);
    } catch (e) {
      return JSON_OK({ ok: false, error: String(e) });
    }
  },
};