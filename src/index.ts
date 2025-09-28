// src/index.ts

/* --------------------------- Env & Types --------------------------- */
export type Env = {
  BOT_TOKEN: string;             // обов'язково: токен бота
  API_BASE_URL?: string;         // опціонально: базовий URL Telegram API
};

type TgChat = { id: number };
type TgUser = { id: number; language_code?: string };
type TgMessage = { message_id: number; text?: string; chat: TgChat; from?: TgUser };
type TgUpdate = { update_id: number; message?: TgMessage };

/* --------------------------- Consts ------------------------------- */
const WEBHOOK_PATH = "/webhook/senti1984";

/* --------------------------- Telegram utils ----------------------- */
function tgBase(env: Env) {
  const base = env.API_BASE_URL?.replace(/\/+$/, "") || "https://api.telegram.org";
  return `${base}/bot${env.BOT_TOKEN}`;
}

async function tgCall<T>(env: Env, method: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${tgBase(env)}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`tg ${method} HTTP ${res.status}: ${text}`);
  }
  const data = await res.json<any>();
  if (!data?.ok) throw new Error(`tg ${method} not ok: ${JSON.stringify(data)}`);
  return data.result as T;
}

async function sendMessage(env: Env, chat_id: number, text: string, extra?: Record<string, unknown>) {
  return tgCall(env, "sendMessage", {
    chat_id,
    text,
    // не вказуємо parse_mode, щоб уникнути падінь через розмітку
    disable_web_page_preview: true,
    ...extra,
  });
}

/* --------------------------- Helpers ------------------------------ */
function isCommand(msg: TgMessage | undefined, name: string): boolean {
  const t = msg?.text ?? "";
  const re = new RegExp(`^\\/${name}(?:@\\w+)?(?:\\s|$)`, "i");
  return re.test(t);
}
function afterCommandText(msg: TgMessage, name: string): string {
  const t = msg.text ?? "";
  return t.replace(new RegExp(`^\\/${name}(?:@\\w+)?\\s*`, "i"), "");
}

function helpText(): string {
  return [
    "📋 Доступні команди:",
    "",
    "/start – запуск і вітання",
    "/ping – перевірка звʼязку (pong)",
    "/health – перевірка стану сервера",
    "/help – список команд",
    "/wiki <запит> – коротка довідка з Вікіпедії",
    "",
    "⚡ Надалі будуть нові функції (AI, інтеграції тощо).",
  ].join("\n");
}

/* --------------------------- Wiki (uk) ---------------------------- */
async function wikiLookup(query: string, lang = "uk") {
  // 1) Пошук першого збігу
  const searchUrl =
    `https://${lang}.wikipedia.org/w/api.php?action=opensearch&limit=1&namespace=0&format=json&origin=*&search=` +
    encodeURIComponent(query);
  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) throw new Error(`wiki search HTTP ${searchRes.status}`);
  const arr = (await searchRes.json()) as [string, string[], string[], string[]];
  const title = arr?.[1]?.[0];
  if (!title) return null;

  // 2) Короткий опис
  const sumUrl =
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/` + encodeURIComponent(title);
  const sumRes = await fetch(sumUrl, { headers: { "accept": "application/json" } });
  if (!sumRes.ok) throw new Error(`wiki summary HTTP ${sumRes.status}`);
  const sum = await sumRes.json<any>();
  const extract: string = sum.extract || "";
  const url: string = sum.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`;

  return { title, extract, url };
}

/* --------------------------- Handlers ----------------------------- */
async function handleStart(env: Env, msg: TgMessage) {
  return sendMessage(
    env,
    msg.chat.id,
    "✅ Senti онлайн\nНадішли /ping щоб перевірити відповідь."
  );
}
async function handlePing(env: Env, msg: TgMessage) {
  return sendMessage(env, msg.chat.id, "pong ✅");
}
async function handleHealth(env: Env, msg: TgMessage) {
  return sendMessage(env, msg.chat.id, "ok ✅");
}
async function handleHelp(env: Env, msg: TgMessage) {
  return sendMessage(env, msg.chat.id, helpText());
}
async function handleWiki(env: Env, msg: TgMessage) {
  const q = afterCommandText(msg, "wiki").trim();
  if (!q) {
    return sendMessage(env, msg.chat.id, "ℹ️ Використання: /wiki <запит>\nНапр.: /wiki Київ");
  }
  try {
    const res = await wikiLookup(q, (msg.from?.language_code || "uk").split("-")[0] || "uk");
    if (!res) return sendMessage(env, msg.chat.id, `Нічого не знайдено за запитом “${q}”`);
    const text =
      `📖 <b>${res.title}</b>\n\n` +
      `${res.extract}\n\n` +
      `${res.url}`;
    // без parse_mode — щоб уникнути проблем з HTML, просто шлемо текст
    return sendMessage(env, msg.chat.id, text);
  } catch (e) {
    console.error("wiki error:", e);
    return sendMessage(env, msg.chat.id, "❌ Не вдалося отримати дані з Вікіпедії.");
  }
}

/* --------------------------- Webhook router ----------------------- */
async function handleWebhook(env: Env, req: Request): Promise<Response> {
  const update = (await req.json()) as TgUpdate;
  console.log("[webhook] raw update:", JSON.stringify(update));
  const msg = update.message;
  if (!msg) return new Response("OK");

  try {
    if (isCommand(msg, "start"))  await handleStart(env, msg);
    else if (isCommand(msg, "ping"))   await handlePing(env, msg);
    else if (isCommand(msg, "health")) await handleHealth(env, msg);
    else if (isCommand(msg, "help"))   await handleHelp(env, msg);
    else if (isCommand(msg, "wiki"))   await handleWiki(env, msg);
    // інші — ігноруємо тихо
  } catch (e) {
    console.error("handler error:", e);
    // відповідаємо 200, щоб TG не ретраїв
  }
  return new Response("OK");
}

/* --------------------------- Worker entry ------------------------- */
function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // GET /health
    if (req.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, ts: Date.now() });
    }

    // POST /webhook/senti1984
    if (req.method === "POST" && url.pathname === WEBHOOK_PATH) {
      return handleWebhook(env, req);
    }

    // метод не дозволено
    if (!["GET", "POST"].includes(req.method)) {
      return new Response("Method not allowed", { status: 405 });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;