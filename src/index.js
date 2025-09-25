/**
 * Cloudflare Workers — Telegram bot webhook with inline buttons & menu.
 * Env:
 * - BOT_TOKEN (string, required)
 * - WEBHOOK_SECRET (string, required)
 * - API_BASE_URL (string, optional, default "https://api.telegram.org")
 * - STATE (KV Namespace, optional but recommended for likes)
 */

/** @typedef {import('@cloudflare/workers-types').KVNamespace} KVNamespace */
/** @typedef {{ BOT_TOKEN:string, WEBHOOK_SECRET:string, API_BASE_URL?:string, STATE?:KVNamespace }} Env */

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function ok(data = {}) {
  return new Response(JSON.stringify({ ok: true, ...data }), { headers: JSON_HEADERS });
}
function err(message, status = 200) {
  return new Response(JSON.stringify({ ok: false, error: String(message) }), {
    headers: JSON_HEADERS,
    status,
  });
}

/** Telegram API helper */
async function tg(env, method, body) {
  const base = (env.API_BASE_URL || "https://api.telegram.org").replace(/\/+$/, "");
  const url = `${base}/bot${env.BOT_TOKEN}/${method}`;
  return fetch(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
}

/** Safe JSON read */
async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** ---------- Inline buttons (Like / Dislike) ---------- */

function voteMarkup(likes, dislikes) {
  return {
    inline_keyboard: [
      [
        { text: `👍 ${likes}`, callback_data: "vote:up" },
        { text: `👎 ${dislikes}`, callback_data: "vote:down" },
      ],
    ],
  };
}

async function getInt(kv, key) {
  if (!kv) return 0;
  const v = await kv.get(key);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function incr(kv, key, by = 1) {
  if (!kv) return;
  const cur = await getInt(kv, key);
  await kv.put(key, String(cur + by));
}

/** Update buttons after a vote */
async function handleVote(update, env) {
  const kv = env.STATE;
  const cq = update.callback_query;
  if (!cq?.message) return;

  const chatId = cq.message.chat.id;
  const mid = cq.message.message_id;
  const action = cq.data; // "vote:up" | "vote:down"

  // keys per message
  const kLikes = `likes:${chatId}:${mid}`;
  const kDislikes = `dislikes:${chatId}:${mid}`;

  // totals per chat
  const kLikesTotal = `likes_total:${chatId}`;
  const kDislikesTotal = `dislikes_total:${chatId}`;

  if (action === "vote:up") {
    await incr(kv, kLikes, 1);
    await incr(kv, kLikesTotal, 1);
    await tg(env, "answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "Дякую за 👍",
      show_alert: false,
    });
  } else if (action === "vote:down") {
    await incr(kv, kDislikes, 1);
    await incr(kv, kDislikesTotal, 1);
    await tg(env, "answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "Записав 👎",
      show_alert: false,
    });
  } else {
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
  }

  const likes = await getInt(kv, kLikes);
  const dislikes = await getInt(kv, kDislikes);

  // refresh buttons on the same message
  await tg(env, "editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: mid,
    reply_markup: voteMarkup(likes, dislikes),
  });
}

/** ---------- Commands & handlers ---------- */

async function ensureCommands(env) {
  // Ідемпотентно ставимо глобальне меню (можна викликати хоч щодня)
  await tg(env, "setMyCommands", {
    commands: [
      { command: "start", description: "Привітання" },
      { command: "ping", description: "Перевірка зв’язку" },
      { command: "likepanel", description: "Надіслати кнопки 👍/👎" },
      { command: "stats", description: "Показати статистику голосів" },
      { command: "kvset", description: "KV: зберегти ключ (kvset <key> <value>)" },
      { command: "kvget", description: "KV: прочитати ключ (kvget <key>)" },
    ],
  });
}

/** Handle Telegram update (messages & callbacks) */
async function handleUpdate(update, env) {
  // Callback buttons
  if (update.callback_query) {
    await handleVote(update, env);
    return;
  }

  const msg = update.message || update.edited_message;
  const chatId = msg?.chat?.id;
  if (!chatId) return;

  const text = (msg.text || "").trim();
  const kv = env.STATE;

  // Commands
  if (text === "/start") {
    // Один раз на старт — спробуємо встановити меню (ігноруємо помилки)
    ensureCommands(env).catch(() => {});
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text:
        "👋 Привіт! Бот підключено до Cloudflare Workers.\n" +
        "Команди: /ping, /likepanel, /stats, /kvset <key> <value>, /kvget <key>",
    });
    return;
  }

  if (text === "/menu") {
    await ensureCommands(env);
    await tg(env, "sendMessage", { chat_id: chatId, text: "✅ Меню команд оновлено." });
    return;
  }

  if (text === "/ping") {
    await tg(env, "sendMessage", { chat_id: chatId, text: "pong ✅" });
    return;
  }

  if (text === "/likepanel") {
    const likes = 0, dislikes = 0;
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: "Оціни повідомлення:",
      reply_markup: voteMarkup(likes, dislikes),
    });
    return;
  }

  if (text === "/stats") {
    if (!kv) {
      await tg(env, "sendMessage", { chat_id: chatId, text: "❌ KV не прив'язано (STATE)." });
      return;
    }
    const likes = await getInt(kv, `likes_total:${chatId}`);
    const dislikes = await getInt(kv, `dislikes_total:${chatId}`);
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: `📊 Статистика в чаті:\n👍 ${likes}\n👎 ${dislikes}`,
    });
    return;
  }

  // KV set/get
  if (text.startsWith("/kvset")) {
    const [, key, ...rest] = text.split(/\s+/);
    const value = rest.join(" ");
    if (!kv) {
      await tg(env, "sendMessage", { chat_id: chatId, text: "❌ KV не прив'язано (STATE)." });
      return;
    }
    if (!key || !value) {
      await tg(env, "sendMessage", { chat_id: chatId, text: "Використання: /kvset <key> <value>" });
      return;
    }
    await kv.put(key, value);
    await tg(env, "sendMessage", { chat_id: chatId, text: `✅ Збережено: ${key} = ${value}` });
    return;
  }

  if (text.startsWith("/kvget")) {
    const [, key] = text.split(/\s+/);
    if (!kv) {
      await tg(env, "sendMessage", { chat_id: chatId, text: "❌ KV не прив'язано (STATE)." });
      return;
    }
    if (!key) {
      await tg(env, "sendMessage", { chat_id: chatId, text: "Використання: /kvget <key>" });
      return;
    }
    const value = await kv.get(key);
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: value != null ? `🗄 ${key} = ${value}` : `😕 Не знайдено ключ: ${key}`,
    });
    return;
  }

  // Files ack
  if (msg?.photo || msg?.document) {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: "📸 Дякую! Отримав файл.",
      reply_to_message_id: msg.message_id,
    });
    return;
  }

  // Echo
  if (text) {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: `Ти написав: ${text}`,
      reply_to_message_id: msg.message_id,
    });
    return;
  }
}

export default {
  /** @param {Request} request @param {Env} env */
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/healthz")) {
      return ok({ service: "senti-bot-worker", env: "ok" });
    }

    // Webhook
    if (url.pathname === `/webhook/${env.WEBHOOK_SECRET}`) {
      if (request.method !== "POST") return err("Method must be POST");
      const update = await readJson(request);
      if (!update) return err("Invalid JSON");

      // Fire-and-forget
      handleUpdate(update, env).catch((e) =>
        console.error("handleUpdate error:", e?.stack || e)
      );

      return ok({ received: true });
    }

    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  },
};