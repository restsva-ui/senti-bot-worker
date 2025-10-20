      // ===== Telegram webhook =====
      if (p === "/webhook" && req.method === "POST") {
        try {
          if (!checkTelegramHeaderSecret(req, env)) {
            return json({ ok: false, error: "unauthorized" }, 401, CORS);
          }
          const r = await handleTelegramWebhook?.(req, env, url);
          if (r) return r;
        } catch (e) {
          console.error("webhook error:", e);
          return json({ ok: false, error: String(e?.message || e) }, 500, CORS);
        }
        return json({ ok: true, note: "fallback webhook POST" }, 200, CORS);
      }

      // ===== Telegram helpers =====
      if (p === "/tg/get-webhook") {
        const token = getBotToken(env);
        const r = await TG.getWebhook(token);
        return new Response(await r.text(), { headers: { "content-type": "application/json" } });
      }
      if (p === "/tg/set-webhook") {
        const token = getBotToken(env);
        const secret = getWebhookSecret(env);
        const target = abs(env, "/webhook");
        const r = await TG.setWebhook(token, target, secret);
        return new Response(await r.text(), { headers: { "content-type": "application/json" } });
      }
      if (p === "/tg/del-webhook") {
        const token = getBotToken(env);
        const r = (await TG.deleteWebhook?.(token)) || (await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`));
        return new Response(await r.text(), { headers: { "content-type": "application/json" } });
      }

      // ===== CI note =====
      if (p.startsWith("/ci/deploy-note")) {
        try { const r = await handleCiDeploy?.(req, env, url); if (r) return r; } catch {}
        return json({ ok: true }, 200, CORS);
      }

      // ===== OAuth Google Drive =====
      if (p === "/auth/start") {
        const u = url.searchParams.get("u");
        const state = btoa(JSON.stringify({ u }));
        const redirect_uri = abs(env, "/auth/cb");
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
        const redirect_uri = abs(env, "/auth/cb");
        const body = new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri,
          grant_type: "authorization_code",
        });
        const r = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });
        const d = await r.json();
        if (!r.ok) return html(`<pre>${JSON.stringify(d, null, 2)}</pre>`);
        const tokens = {
          access_token: d.access_token,
          refresh_token: d.refresh_token,
          expiry: Math.floor(Date.now() / 1000) + (d.expires_in || 3600) - 60,
        };
        await putUserTokens(env, state.u, tokens);
        return html(`<h3>✅ Готово</h3><p>Тепер повернись у Telegram і натисни <b>Google Drive</b> ще раз.</p>`);
      }

      // 404 + лог у checklist
      await safeChecklist(env, `[miss] ${new Date().toISOString()} ${req.method} ${p}${url.search}`);
      return json({ ok: false, error: "Not found", path: p }, 404, CORS);
    } catch (e) {
      console.error("fetch error:", e);
      return json({ ok: false, error: String(e) }, 500, CORS);
    }
  },

  async scheduled(event, env) {
    // Heartbeat
    await logHeartbeat(env);

    // Погодинний evolve
    try {
      if (event && event.cron === "0 * * * *") {
        const u = new URL(abs(env, "/ai/evolve/auto"));
        if (env.WEBHOOK_SECRET) u.searchParams.set("s", env.WEBHOOK_SECRET);
        const req = new Request(u.toString(), { method: "GET" });
        await handleAiEvolve?.(req, env, u);
      }
    } catch (e) {
      await safeChecklist(env, `[${new Date().toISOString()}] evolve_auto:error ${String(e)}`);
    }

    // Нічні авто-поліпшення + саморегуляція
    try {
      const hour = new Date().getUTCHours();
      const targetHour = Number(env.NIGHTLY_UTC_HOUR ?? 2);
      const runByCron = event && event.cron === "10 2 * * *";
      const runByHour = hour === targetHour;
      if (String(env.AUTO_IMPROVE || "on").toLowerCase() !== "off" && (runByCron || runByHour)) {
        const res = await nightlyAutoImprove(env, { now: new Date(), reason: event?.cron || `utc@${hour}` });
        if (String(env.SELF_REGULATE || "on").toLowerCase() !== "off") {
          await runSelfRegulation(env, res?.insights || null).catch(() => {});
        }
      }
    } catch (e) {
      await safeChecklist(env, `[${new Date().toISOString()}] auto_improve:error ${String(e)}`);
    }

    // 🎓 Нічний прогін черги Learn
    try {
      await runLearnOnce(env, {});
    } catch (e) {
      await safeChecklist(env, `[${new Date().toISOString()}] learn_queue:error ${String(e)}`);
    }
  },
};
