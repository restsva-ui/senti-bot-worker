/* --------------------------- Env & Imports --------------------------- */
export type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;

  // --- Безпека вебхука ---
  WEBHOOK_SECRET?: string;

  // --- KV для антидублів (LIKES_KV = senti-state) ---
  LIKES_KV: KVNamespace;
};

import type { TgUpdate } from "./types";
import { seenUpdateRecently } from "./utils/dedup";
import { verifyWebhook } from "./middlewares/verifyWebhook";
import { handleDedupTest } from "./routes/dedupTest";
import { handleHealth } from "./routes/health";
import { routeUpdate } from "./router/commandRouter";

/* --------------------------- Constants ------------------------------- */
const WEBHOOK_PATH = "/webhook/senti1984";

/* --------------------------- Utils ----------------------------------- */
function parseJson<T = unknown>(req: Request): Promise<T> {
  return req.json() as Promise<T>;
}

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

/* --------------------------- Router (Webhook) ------------------------ */
async function handleWebhook(env: Env, req: Request): Promise<Response> {
  // 1) Перевірка секрету
  const deny = verifyWebhook(req, env.WEBHOOK_SECRET);
  if (deny) return deny;

  // 2) Парсимо апдейт
  const update = await parseJson<TgUpdate>(req);

  // 3) Антидубль (KV)
  const updateId = (update as any)?.update_id as number | undefined;
  if (typeof updateId === "number") {
    const isDup = await seenUpdateRecently(env, updateId, 120); // 2 хвилини
    if (isDup) {
      return new Response("OK");
    }
  }

  // 4) Передаємо в роутер команд
  await routeUpdate(env, update);

  // 5) Тихий OK (навіть якщо команда не знайдена)
  return new Response("OK");
}

/* --------------------------- Worker export --------------------------- */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // 1) Healthcheck (GET)
    if (req.method === "GET" && url.pathname === "/health") {
      return handleHealth();
    }

    // 1.1) Тест антидублів (GET /__dedup_test/:id[?ttl=...])
    if (req.method === "GET" && url.pathname.startsWith("/__dedup_test/")) {
      const id = url.pathname.split("/__dedup_test/")[1] || "0";
      const ttlParam = url.searchParams.get("ttl");
      const ttl = ttlParam ? Number(ttlParam) : 120;
      return handleDedupTest(env, id, ttl);
    }

    // 2) Webhook (POST)
    if (req.method === "POST" && url.pathname === WEBHOOK_PATH) {
      try {
        return await handleWebhook(env, req);
      } catch (e) {
        console.error("webhook error:", e);
        return new Response("OK");
      }
    }

    // 3) Інші методи/шляхи
    if (req.method !== "GET" && req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;