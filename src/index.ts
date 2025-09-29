import { routeUpdate } from "./router/commandRouter";

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    if (request.method === "POST") {
      const update = await request.json();
      try {
        return await routeUpdate(env, update);
      } catch (e: any) {
        console.error("routeUpdate error:", e?.stack || e);
        return new Response("ERROR", { status: 500 });
      }
    }
    return new Response("OK");
  },
};