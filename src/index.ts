export interface Env {}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(req: Request, _env: Env): Promise<Response> {
    const url = new URL(req.url);

    // 1) health-check
    if (url.pathname === "/health") {
      return json({ ok: true, ts: Date.now() });
    }

    // 2) все інше — 404 (щоб явно бачити, що працює воркер)
    return new Response("Not found", { status: 404 });
  },
};