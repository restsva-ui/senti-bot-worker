export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Технічна перевірка: GET /health → 200 OK
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, name: "senti-bot-worker" }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // Заглушка під Telegram webhook: POST /webhook → echo
    if (request.method === "POST" && url.pathname === "/webhook") {
      let bodyText = "";
      try { bodyText = await request.text(); } catch {}
      return new Response(JSON.stringify({ ok: true, received: bodyText.slice(0, 1024) }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // Інші маршрути
    return new Response("Not Found", { status: 404 });
  },
};
