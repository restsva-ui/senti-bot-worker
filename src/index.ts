import { setEnv, type Env } from "./config";
import { handleUpdate } from "./router";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    setEnv(env); // <- критично: ініціалізуємо CFG.kv, BOT_TOKEN тощо

    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/webhook/senti1984") {
      const update = await request.json();
      await handleUpdate(update);
      return new Response("ok");
    }

    if (url.pathname === "/ping") {
      return new Response("ok");
    }

    return new Response("Not found", { status: 404 });
  },
};