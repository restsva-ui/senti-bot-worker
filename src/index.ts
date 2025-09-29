// src/index.ts
import { commandRouter } from "./router/commandRouter";
import type { TgUpdate } from "./types";

type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
  LIKES_KV?: any;
  WEBHOOK_SECRET?: string;
  OWNER_ID?: string;
};

function isTelegramRequest(req: Request): boolean {
  // Telegram завжди шле JSON POST на вебхук
  return req.method === "POST";
}

function checkSecret(req: Request, env: Env): boolean {
  const expected = env.WEBHOOK_SECRET?.trim();
  if (!expected) return true; // секрет не задано — пропускаємо (для локалки)
  const got = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  return got === expected;
}

async function parseUpdate(req: Request): Promise<TgUpdate | null> {
  try {
    const u = (await req.json()) as TgUpdate;
    return u ?? null;
  } catch {
    return null;
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // health для швидкої перевірки
    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
      return new Response("OK", { status: 200 });
    }

    // Приймаємо вебхук на /webhook і на будь-який інший шлях (на випадок, якщо поставили вебхук на корінь)
    if (isTelegramRequest(req)) {
      if (!checkSecret(req, env)) {
        // Не логай сам секрет, лише факт розбіжності
        console.warn("Webhook rejected: bad secret");
        return new Response("forbidden", { status: 403 });
      }

      const update = await parseUpdate(req);
      if (!update) {
        console.warn("Empty/invalid update body");
        return new Response("bad request", { status: 400 });
      }

      try {
        const resp = await commandRouter(env, update);
        // всередині router ми вже повертаємо Response; але Telegram очікує 200 швидко
        // Якщо router вернув щось не 2xx — все одно дамо OK, щоб не було ретраїв
        if (!resp || resp.status >= 300) {
          return new Response("OK");
        }
        return resp;
      } catch (e) {
        console.error("commandRouter error:", e);
        // Віддаємо 200, щоб Telegram не ретраїв, а ми подивимося логи
        return new Response("OK");
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};