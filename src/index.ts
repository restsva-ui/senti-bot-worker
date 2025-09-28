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

/** Надійний парсер команд: читає entities + робить резервний парс по тексту. */
function getCommand(msg?: TgMessage): { name: string | null; args: string } {
  const text = msg?.text ?? "";

  // 1) Пробуємо entities
  const ent = msg?.entities?.find(e => e.type === "bot_command" && e.offset === 0);
  if (ent) {
    const raw = text.slice(ent.offset, ent.offset + ent.length); // наприклад "/help@mybot"
    const name = raw.replace(/^\/+/, "").split("@")[0].toLowerCase(); // -> "help"
    const args = text.slice(ent.offset + ent.length).trimStart();
    return { name, args };
  }

  // 2) Резервний парс по рядку (на випадок відсутніх entities)
  const m = text.match(/^\/(\w+)(?:@\w+)?(?:\s+|$)/);
  if (m) {
    const name = m[1].toLowerCase();
    const args = text.slice(m[0].length).trimStart();
    return { name, args };
  }

  return { name: null, args: "" };
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
  const { name } = getCommand(msg);

  switch (name) {
    case "start":  await cmdStart(env, update);  break;
    case "ping":   await cmdPing(env, update);   break;
    case "health": await cmdHealth(env, update); break;
    case "help":   await cmdHelp(env, update);   break;
    case "wiki":   await cmdWiki(env, update);   break;
    default:
      // мовчазна відповідь на будь-який інший апдейт/текст
      break;
  }

  // Завжди 200 для TG
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
        return new Response("OK");
      }
    }

    if (req.method !== "GET" && req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;