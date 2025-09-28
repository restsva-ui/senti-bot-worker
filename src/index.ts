/* --------------------------- Imports & Types ------------------------- */
import type { Env, TgMessage, TgUpdate } from "./types";
import { cmdStart }   from "./commands/start";
import { cmdPing }    from "./commands/ping";
import { cmdHealth }  from "./commands/health";
import { cmdHelp }    from "./commands/help";
import { cmdWiki }    from "./commands/wiki";

/* --------------------------- Constants ------------------------------- */
const WEBHOOK_PATH = "/webhook/senti1984";

/* --------------------------- Utils ---------------------------------- */
function parseJson<T = unknown>(req: Request): Promise<T> {
  return req.json() as Promise<T>;
}

function isCommand(msg?: TgMessage, name?: string) {
  const t = msg?.text ?? "";
  if (!name) return false;
  const re = new RegExp(`^\\/${name}(?:@\\w+)?(?:\\s|$)`, "i");
  return re.test(t);
}

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

/* --------------------------- Webhook -------------------------------- */
async function handleWebhook(env: Env, req: Request): Promise<Response> {
  const update = await parseJson<TgUpdate>(req);
  console.log("[webhook] raw update:", JSON.stringify(update));

  const msg = update.message;

  if (isCommand(msg, "start"))  { await cmdStart(env, update);  return new Response("OK"); }
  if (isCommand(msg, "ping"))   { await cmdPing(env, update);   return new Response("OK"); }
  if (isCommand(msg, "health")) { await cmdHealth(env, update); return new Response("OK"); }
  if (isCommand(msg, "help"))   { await cmdHelp(env, update);   return new Response("OK"); }
  if (isCommand(msg, "wiki"))   { await cmdWiki(env, update);   return new Response("OK"); }

  // мовчазна відповідь для нерозпізнаного апдейту
  return new Response("OK");
}

/* --------------------------- Worker export --------------------------- */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Healthcheck
    if (req.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, ts: Date.now() });
    }

    // Telegram webhook
    if (req.method === "POST" && url.pathname === WEBHOOK_PATH) {
      try {
        return await handleWebhook(env, req);
      } catch (e) {
        console.error("webhook error:", e);
        // Завжди 200, щоб Telegram не ретраїв агресивно
        return new Response("OK");
      }
    }

    if (req.method !== "GET" && req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;