// src/index.ts
/* --------------------------- Imports & Types ------------------------- */
import type { Env, TgMessage, TgUpdate } from "./types";
import { cmdStart }   from "./commands/start";
import { cmdPing }    from "./commands/ping";
import { cmdHealth }  from "./commands/health";
import { cmdHelp }    from "./commands/help";
import { cmdWiki }    from "./commands/wiki";

/* --------------------------- Constants ------------------------------- */
const WEBHOOK_PATH = "/webhook/senti1984";

/* --------------------------- Small utils ----------------------------- */
function parseJson<T = unknown>(req: Request): Promise<T> {
  return req.json() as Promise<T>;
}

/** Прибираємо невидимі символи/пробіли з початку. */
function sanitizeHead(s: string): string {
  // LRM, RLM, ALM, NBSP, NNBSP, ZWSP, ZWNJ, WJ тощо
  const LEADING_JUNK = /^[\u200E\u200F\u061C\u00A0\u202F\u2000-\u200B\u2060\uFEFF]+/u;
  return s.replace(LEADING_JUNK, "");
}

/** Надійне визначення команди */
function getCommand(msg?: TgMessage): { name: string | null; args: string } {
  let text = msg?.text ?? "";
  text = sanitizeHead(text);

  // 1) Entities: інколи offset стає 1 через LRM — дозволяємо 0 або 1
  const ent = msg?.entities?.find(
    e => e.type === "bot_command" && (e.offset === 0 || e.offset === 1)
  );
  if (ent) {
    const start = Math.max(0, ent.offset);
    const raw = text.slice(start, start + ent.length); // "/help@bot"
    const name = raw.replace(/^\/+/, "").split("@")[0].toLowerCase();
    const args = text.slice(start + ent.length).trimStart();
    return { name, args };
  }

  // 2) Резервний парс по рядку (враховуємо можливі NBSP/NNBSP після команди)
  const SPACE_CLASS = "[\\u0009\\u000A\\u000B\\u000C\\u000D\\u0020\\u00A0\\u202F]";
  const re = new RegExp("^\\/(\\w+)(?:@\\w+)?(?:" + SPACE_CLASS + "+|$)", "u");
  const m = text.match(re);
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
      // без відповіді на сторонні повідомлення
      break;
  }
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

    // Webhook
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