/**
 * Cloudflare Workers — Telegram bot with inline buttons & robust commands.
 * Env:
 * - BOT_TOKEN (string, required)
 * - WEBHOOK_SECRET (string, required)
 * - API_BASE_URL (string, optional, default "https://api.telegram.org")
 * - STATE (KV Namespace, optional — для лічильників)
 */

/** @typedef {import('@cloudflare/workers-types').KVNamespace} KVNamespace */
/** @typedef {{ BOT_TOKEN:string, WEBHOOK_SECRET:string, API_BASE_URL?:string, STATE?:KVNamespace }} Env */

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

const ok  = (data={}) => new Response(JSON.stringify({ ok:true, ...data }), { headers: JSON_HEADERS });
const err = (message, status=200) =>
  new Response(JSON.stringify({ ok:false, error: String(message) }), { headers: JSON_HEADERS, status });

function baseUrl(env){ return (env.API_BASE_URL||"https://api.telegram.org").replace(/\/+$/,""); }
async function tg(env, method, body){
  const url = `${baseUrl(env)}/bot${env.BOT_TOKEN}/${method}`;
  const res = await fetch(url, { method:"POST", headers: JSON_HEADERS, body: JSON.stringify(body)});
  // зручний лог на випадок фейлів Bot API
  if (!res.ok) {
    const txt = await res.text().catch(()=>"<no body>");
    console.error("TG API error", method, res.status, txt);
  }
  return res;
}
async function readJson(req){ try { return await req.json(); } catch { return null; } }

/* --------- helpers for like/dislike --------- */
function voteMarkup(likes, dislikes){
  return { inline_keyboard: [[
    { text: `👍 ${likes}`, callback_data: "vote:up" },
    { text: `👎 ${dislikes}`, callback_data: "vote:down" },
  ]]};
}
async function getInt(kv, key){ if(!kv) return 0; const v = await kv.get(key); const n = Number(v); return Number.isFinite(n)?n:0; }
async function incr(kv, key, by=1){ if(!kv) return; const cur = await getInt(kv, key); await kv.put(key, String(cur+by)); }

/* --------- robust command parsing ---------
 * Повертає: {cmd:"/ping", args:"foo bar"} або null якщо це не команда
 */
function parseCommand(msg){
  const text = msg?.text ?? "";
  if (!text) return null;

  // якщо Telegram додав entities з bot_command — вирізаємо точно
  const cmdEnt = (msg.entities||[]).find(e => e.type === "bot_command" && e.offset === 0);
  let raw = cmdEnt ? text.slice(0, cmdEnt.length) : text.split(/\s+/)[0];

  if (!raw.startsWith("/")) return null;

  // прибираємо згадку бота у форматі /cmd@BotName
  raw = raw.replace(/@[\w_]+$/i, "");
  const args = text.slice(raw.length).trim();

  return { cmd: raw.toLowerCase(), args };
}

/* --------- callback (inline buttons) --------- */
async function handleVote(update, env){
  const kv = env.STATE;
  const cq = update.callback_query;
  if (!cq?.message) return;

  const chatId = cq.message.chat.id;
  const mid    = cq.message.message_id;
  const data   = cq.data;

  const kLikes        = `likes:${chatId}:${mid}`;
  const kDislikes     = `dislikes:${chatId}:${mid}`;
  const kLikesTotal   = `likes_total:${chatId}`;
  const kDislikesTotal= `dislikes_total:${chatId}`;

  if (data === "vote:up"){
    await incr(kv, kLikes, 1);
    await incr(kv, kLikesTotal, 1);
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "Дякую за 👍" });
  } else if (data === "vote:down"){
    await incr(kv, kDislikes, 1);
    await incr(kv, kDislikesTotal, 1);
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "Записав 👎" });
  } else {
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
  }

  const likes    = await getInt(kv, kLikes);
  const dislikes = await getInt(kv, kDislikes);

  await tg(env, "editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: mid,
    reply_markup: voteMarkup(likes, dislikes),
  });
}

/* --------- commands menu --------- */
async function ensureCommands(env){
  await tg(env, "setMyCommands", { commands: [
    { command: "start",     description: "Привітання" },
    { command: "ping",      description: "Перевірка зв’язку" },
    { command: "likepanel", description: "Надіслати кнопки 👍/👎" },
    { command: "stats",     description: "Показати статистику голосів" },
    { command: "kvset",     description: "KV: зберегти ключ (kvset <key> <value>)" },
    { command: "kvget",     description: "KV: прочитати ключ (kvget <key>)" },
  ]});
}

/* --------- main update handler --------- */
async function handleUpdate(update, env){
  if (update.callback_query){
    await handleVote(update, env);
    return;
  }

  const msg = update.message || update.edited_message;
  const chatId = msg?.chat?.id;
  if (!chatId) return;

  const kv = env.STATE;
  const cmd = parseCommand(msg);
  const text = (msg.text || "").trim();

  if (cmd) {
    const { cmd: c, args } = cmd;

    if (c === "/start"){
      ensureCommands(env).catch(()=>{});
      await tg(env, "sendMessage", { chat_id: chatId,
        text: "👋 Привіт! Бот підключено до Cloudflare Workers.\n" +
              "Команди: /ping, /likepanel, /stats, /kvset <key> <value>, /kvget <key>"
      });
      return;
    }

    if (c === "/menu"){
      await ensureCommands(env);
      await tg(env, "sendMessage", { chat_id: chatId, text: "✅ Меню команд оновлено." });
      return;
    }

    if (c === "/ping"){
      await tg(env, "sendMessage", { chat_id: chatId, text: "pong ✅" });
      return;
    }

    if (c === "/likepanel"){
      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: "Оціни повідомлення:",
        reply_markup: voteMarkup(0, 0),
      });
      return;
    }

    if (c === "/stats"){
      if (!kv){
        await tg(env, "sendMessage", { chat_id: chatId, text: "❌ KV не прив'язано (STATE)." });
        return;
      }
      const likes = await getInt(kv, `likes_total:${chatId}`);
      const dislikes = await getInt(kv, `dislikes_total:${chatId}`);
      await tg(env, "sendMessage", { chat_id: chatId, text: `📊 Статистика:\n👍 ${likes}\n👎 ${dislikes}` });
      return;
    }

    if (c === "/kvset"){
      const [key, ...rest] = args.split(/\s+/).filter(Boolean);
      const value = rest.join(" ");
      if (!kv){ await tg(env,"sendMessage",{chat_id:chatId,text:"❌ KV не прив'язано (STATE)."}); return; }
      if (!key || !value){ await tg(env,"sendMessage",{chat_id:chatId,text:"Використання: /kvset <key> <value>"}); return; }
      await kv.put(key, value);
      await tg(env,"sendMessage",{chat_id:chatId,text:`✅ Збережено: ${key} = ${value}`});
      return;
    }

    if (c === "/kvget"){
      const key = args.split(/\s+/).filter(Boolean)[0];
      if (!kv){ await tg(env,"sendMessage",{chat_id:chatId,text:"❌ KV не прив'язано (STATE)."}); return; }
      if (!key){ await tg(env,"sendMessage",{chat_id:chatId,text:"Використання: /kvget <key>"}); return; }
      const value = await kv.get(key);
      await tg(env,"sendMessage",{chat_id:chatId,text: value!=null ? `🗄 ${key} = ${value}` : `😕 Не знайдено ключ: ${key}`});
      return;
    }
    // невідома команда -> впадемо у echo нижче
  }

  // файли
  if (msg?.photo || msg?.document){
    await tg(env, "sendMessage", { chat_id: chatId, text: "📸 Дякую! Отримав файл.", reply_to_message_id: msg.message_id });
    return;
  }

  // echo
  if (text){
    await tg(env, "sendMessage", { chat_id: chatId, text: `Ти написав: ${text}`, reply_to_message_id: msg.message_id });
  }
}

export default {
  async fetch(request, env){
    const url = new URL(request.url);

    if (request.method==="GET" && (url.pathname==="/" || url.pathname==="/healthz")){
      return ok({ service:"senti-bot-worker", env:"ok" });
    }

    if (url.pathname === `/webhook/${env.WEBHOOK_SECRET}`){
      if (request.method !== "POST") return err("Method must be POST");
      const update = await readJson(request);
      if (!update) return err("Invalid JSON");
      handleUpdate(update, env).catch(e => console.error("handleUpdate error:", e?.stack || e));
      return ok({ received:true });
    }

    return new Response("Not found", { status:404, headers:{"content-type":"text/plain"} });
  }
};