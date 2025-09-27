// Minimal, safe webhook handler to confirm delivery from Telegram
// Does not change existing logic for other routes.

export interface Env {
  // залишаємо місце для інших биндингів, якщо вони вже є
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    // 1) Health: GET/POST -> 200 OK (Telegram інколи “простукує” це)
    if (path === "/health") {
      if (method === "GET") return new Response("ok", { status: 200 });
      if (method === "POST") {
        // просто з’їдаємо тіло і відповідаємо 200
        try {
          const bodyText = await request.text();
          console.log("[health] POST body:", bodyText);
        } catch (_) {}
        return new Response("ok", { status: 200 });
      }
    }

    // 2) Наш вебхук: лише підтверджуємо прийом і логуємо апдейт
    if (path === "/webhook/senti1984" && method === "POST") {
      try {
        const text = await request.text(); // читаємо як текст, щоб уникнути помилок парсингу
        // логимо СИРОГО листа, щоб точно побачити, що приходить від Telegram
        console.log("[webhook] raw update:", text);
      } catch (e) {
        console.log("[webhook] read error:", (e as Error).message);
      }
      // ВАЖЛИВО: миттєво 200, щоб Telegram був щасливий
      return new Response("ok", { status: 200 });
    }

    // 3) Фолбек: нічого не міняємо у решті маршрутів
    return new Response("Not found", { status: 404 });
  },
};