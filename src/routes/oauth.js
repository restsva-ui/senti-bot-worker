// src/routes/oauth.js
export const oauthRoutes = async (req, env, url, { putUserTokens }) => {
  const p = url.pathname;

  if (p === "/auth/start") {
    const u = url.searchParams.get("u");
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
    if(!r.ok) {
      return new Response(`<pre>${JSON.stringify(d,null,2)}</pre>`, { headers:{ "content-type":"text/html; charset=utf-8" }});
    }
    const tokens = {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expiry: Math.floor(Date.now()/1000) + (d.expires_in||3600) - 60,
    };
    await putUserTokens(env, state.u, tokens);
    return new Response(`<h3>✅ Готово</h3><p>Тепер повернись у Telegram і натисни <b>Google Drive</b> ще раз.</p>`, {
      headers:{ "content-type":"text/html; charset=utf-8" }
    });
  }

  return null; // не оброблено
};