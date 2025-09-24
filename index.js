// Senti Telegram Bot for Cloudflare Workers
// Text fallback: Gemini -> DeepSeek -> Groq
// Vision: Gemini
// Memory: Upstash Redis (REST)

const TG_API = "https://api.telegram.org";

const TIMEOUT_MS = 25000;                 // таймаут на один провайдер
const MAX_HISTORY_CHARS = 4000;           // обрізання історії для пам'яті
const REDIS_PREFIX = "senti:history:";    // ключі в Redis

// ---------------------- УТИЛІТИ ----------------------

function withTimeout(ms, fetchPromise) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort("timeout"), ms);
  return fetchPromise(ctrl.signal).finally(() => clearTimeout(t));
}

async function sendTyping(env, chatId) {
  try {
    await fetch(`${TG_API}/bot${env.TELEGRAM_TOKEN}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
  } catch {}
}

async function sendMessage(env, chatId, text, replyToMessageId) {
  return fetch(`${TG_API}/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_to_message_id: replyToMessageId,
      parse_mode: "Markdown",
    }),
  });
}

async function getFileLink(env, fileId) {
  const r = await fetch(`${TG_API}/bot${env.TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
  const j = await r.json();
  if (!j.ok) throw new Error("getFile failed");
  const path = j.result.file_path;
  return `${TG_API}/file/bot${env.TELEGRAM_TOKEN}/${path}`;
}

async function fetchAsBase64(url) {
  const r = await fetch(url);
  const buf = await r.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // base64
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ---------------------- REDIS (Upstash REST) ----------------------

async function redisGet(env, key) {
  const r = await fetch(`${env.REDIS_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${env.REDIS_TOKEN}` },
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j.result ?? null;
}

async function redisSet(env, key, value, ttlSeconds = 86400) {
  await fetch(`${env.REDIS_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ value, EX: ttlSeconds }),
  });
}

// обмежуємо довжину історії
function clampHistory(str, maxChars) {
  if (!str) return "";
  if (str.length <= maxChars) return str;
  return str.slice(-maxChars);
}

// ---------------------- ВИБІР МОДЕЛЕЙ ----------------------

function parseProviders(env) {
  // приклад: "text:gemini,deepseek,groq;vision:gemini"
  const value = env.AI_PROVIDERS || "text:gemini,deepseek,groq;vision:gemini";
  const out = { text: ["gemini", "deepseek", "groq"], vision: ["gemini"] };
  value.split(";").forEach((seg) => {
    const [k, v] = seg.split(":");
    if (k && v) out[k.trim()] = v.split(",").map((s) => s.trim()).filter(Boolean);
  });
  return out;
}

// ---------------------- ЗАПИТИ ДО МОДЕЛЕЙ ----------------------

// Gemini (text + vision) — Google Generative Language API
async function askGemini(env, { prompt, history, imageBase64 }) {
  const model = env.AI_MODEL || "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

  const contents = [];

  if (history) {
    contents.push({ role: "user", parts: [{ text: `Контекст: ${history}` }] });
  }
  if (imageBase64) {
    contents.push({
      role: "user",
      parts: [
        { text: prompt || "Опиши зображення українською, додай короткі висновки." },
        {
          inline_data: {
            mime_type: "image/jpeg",
            data: imageBase64,
          },
        },
      ],
    });
  } else {
    contents.push({ role: "user", parts: [{ text: prompt }] });
  }

  const body = { contents, generationConfig: { temperature: 0.7 } };

  const req = (signal) =>
    fetch(url, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const resp = await withTimeout(TIMEOUT_MS, req);
  if (!resp.ok) throw new Error("Gemini HTTP " + resp.status);
  const data = await resp.json();

  const txt = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  if (!txt) throw new Error("Gemini empty");
  return txt.trim();
}

// DeepSeek (text) — Chat Completions API
async function askDeepSeek(env, { prompt, history }) {
  const url = "https://api.deepseek.com/v1/chat/completions";
  const messages = [];

  if (history) {
    messages.push({
      role: "system",
      content:
        "Короткий контекст попередньої розмови (українською): " +
        clampHistory(history, 1000),
    });
  }
  messages.push({ role: "user", content: prompt });

  const body = {
    model: "deepseek-chat",
    messages,
    temperature: 0.7,
  };

  const req = (signal) =>
    fetch(url, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

  const resp = await withTimeout(TIMEOUT_MS, req);
  if (!resp.ok) throw new Error("DeepSeek HTTP " + resp.status);
  const data = await resp.json();
  const txt = data?.choices?.[0]?.message?.content || "";
  if (!txt) throw new Error("DeepSeek empty");
  return txt.trim();
}

// Groq (text) — OpenAI-сумісний Chat Completions
async function askGroq(env, { prompt, history }) {
  const url = "https://api.groq.com/openai/v1/chat/completions";
  const model = "llama-3.1-70b-versatile";

  const messages = [];
  if (history) {
    messages.push({
      role: "system",
      content:
        "Короткий контекст попередньої розмови (українською): " +
        clampHistory(history, 1000),
    });
  }
  messages.push({ role: "user", content: prompt });

  const body = {
    model,
    messages,
    temperature: 0.7,
  };

  const req = (signal) =>
    fetch(url, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

  const resp = await withTimeout(TIMEOUT_MS, req);
  if (!resp.ok) throw new Error("Groq HTTP " + resp.status);
  const data = await resp.json();
  const txt = data?.choices?.[0]?.message?.content || "";
  if (!txt) throw new Error("Groq empty");
  return txt.trim();
}

// ---------------------- ДІАЛОГОВА ЛОГІКА ----------------------

async function answerText(env, chatId, text, replyToMessageId) {
  const historyKey = `${REDIS_PREFIX}${chatId}`;
  const history = await redisGet(env, historyKey);

  const providers = parseProviders(env).text; // порядок пріоритетів
  let lastErr;
  await sendTyping(env, chatId);

  for (const p of providers) {
    try {
      let out;
      if (p === "gemini") out = await askGemini(env, { prompt: text, history });
      else if (p === "deepseek") out = await askDeepSeek(env, { prompt: text, history });
      else if (p === "groq") out = await askGroq(env, { prompt: text, history });
      else continue;

      // зберегти пам'ять (простий конкат)
      const newHistory = clampHistory(`${history || ""}\nQ: ${text}\nA: ${out}\n`, MAX_HISTORY_CHARS);
      await redisSet(env, historyKey, newHistory);

      await sendMessage(env, chatId, out, replyToMessageId);
      return;
    } catch (e) {
      lastErr = e;
      // пробуємо наступного
    }
  }

  // якщо всі впали
  await sendMessage(
    env,
    chatId,
    "Вибач, зараз я перевантажений. Спробуй ще раз трохи пізніше 🙏",
    replyToMessageId
  );
  if (env.DEBUG_LOGS === "1") console.log("All providers failed:", lastErr);
}

async function answerPhoto(env, chatId, photoSizes, caption, replyToMessageId) {
  const best = photoSizes[photoSizes.length - 1]; // найбільша
  const fileLink = await getFileLink(env, best.file_id);
  const b64 = await fetchAsBase64(fileLink);

  const historyKey = `${REDIS_PREFIX}${chatId}`;
  const history = await redisGet(env, historyKey);

  const prompt =
    (caption && caption.trim()) ||
    "Опиши зображення українською й додай стислі висновки списком.";

  await sendTyping(env, chatId);

  // для зображень — лише Gemini (за конфігом vision:gemini)
  let out;
  try {
    out = await askGemini(env, { prompt, history, imageBase64: b64 });
  } catch (e) {
    await sendMessage(
      env,
      chatId,
      "Не вдалося обробити фото зараз. Спробуй ще раз пізніше 🙏",
      replyToMessageId
    );
    if (env.DEBUG_LOGS === "1") console.log("Vision failed:", e);
    return;
  }

  const newHistory = clampHistory(
    `${history || ""}\n[Фото] ${caption || ""}\nA: ${out}\n`,
    MAX_HISTORY_CHARS
  );
  await redisSet(env, historyKey, newHistory);

  await sendMessage(env, chatId, out, replyToMessageId);
}

// ---------------------- WEBHOOK/HANDLER ----------------------

async function handleUpdate(env, update) {
  const msg = update.message;
  if (!msg) return new Response("ok");

  const chatId = msg.chat.id;
  const replyTo = msg.message_id;

  // простий роутер команд
  if (msg.text) {
    const text = msg.text.trim();

    if (text === "/start") {
      const hello =
        `Привіт, ${msg.from?.first_name || "друже"}! 🚀 Давай зробимо цей день яскравішим.\n\n` +
        `• Надішли *текст* — відповім лаконічно.\n` +
        `• Пришли *фото* — опишу і дам *висновки*.\n\n` +
        `_Під капотом: Gemini → DeepSeek → Groq (fallback), пам’ять у Redis._`;
      await sendMessage(env, chatId, hello, replyTo);
      return new Response("ok");
    }

    // звичайний текст
    await answerText(env, chatId, text, replyTo);
    return new Response("ok");
  }

  if (msg.photo && msg.photo.length) {
    await answerPhoto(env, chatId, msg.photo, msg.caption || "", replyTo);
    return new Response("ok");
  }

  // інші типи — ввічлива відповідь
  await sendMessage(
    env,
    chatId,
    "Надішли, будь ласка, текст або фото 📷 — і я допоможу!",
    replyTo
  );
  return new Response("ok");
}

// ---------------------- WORKER ENTRY ----------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Ping/health
    if (url.pathname === "/") return new Response("ok", { status: 200 });

    // Одноразове ручне встановлення webhook (за потреби)
    if (url.pathname === "/setwebhook") {
      const secret = url.searchParams.get("secret");
      if (secret !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });

      const hookUrl = `${url.origin}/webhook?secret=${env.WEBHOOK_SECRET}`;
      const r = await fetch(`${TG_API}/bot${env.TELEGRAM_TOKEN}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: hookUrl,
          secret_token: env.WEBHOOK_SECRET,
          allowed_updates: ["message"],
        }),
      });
      const j = await r.json();
      return new Response(JSON.stringify(j), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Вебхук
    if (url.pathname === "/webhook") {
      const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (secretHeader !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });

      const update = await request.json();
      // захист від дублікатів простим idempotency ключем (опційно)
      // можна використати Redis SETNX, але тримаємо мінімалізм

      try {
        return await handleUpdate(env, update);
      } catch (e) {
        if (env.DEBUG_LOGS === "1") console.log("handleUpdate error", e);
        return new Response("ok"); // не провалюємо вебхук
      }
    }

    return new Response("not found", { status: 404 });
  },
};