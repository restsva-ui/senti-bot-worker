// index.js — Senti Worker (text + photo AI analysis)
// Cloudflare Workers runtime

/**
 * ENV REQUIRED:
 *   TELEGRAM_BOT_TOKEN   - токен бота
 *   WEBHOOK_SECRET       - секрет для перевірки вебхука
 *
 * OPTIONAL (вмикає AI):
 *   AI_PROVIDER          - "CLOUDFLARE" | "OPENAI" | "ECHO"  (за замовчуванням "ECHO")
 *
 *   # Cloudflare Workers AI (рекомендовано на CF)
 *   CF_AI_ACCOUNT_ID     - твій Cloudflare Account ID
 *   CF_AI_TOKEN          - API Token з правами Workers AI:Read/Write
 *   CF_AI_TEXT_MODEL     - (необов’язково) напр. "llama-3.1-8b-instruct"
 *   CF_AI_VISION_MODEL   - (необов’язково) напр. "llava-1.5-7b-hf"
 *
 *   # OpenAI (як альтернатива)
 *   OPENAI_API_KEY
 *   OPENAI_TEXT_MODEL    - напр. "gpt-4o-mini"
 *   OPENAI_VISION_MODEL  - напр. "gpt-4o-mini"
 */

export default {
  async fetch(req, env, ctx) {
    try {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/") {
        return plain(200, "Senti Worker is alive.");
      }
      if (req.method === "GET" && url.pathname === "/health") {
        return json(200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/debug") {
        return json(200, {
          provider: env.AI_PROVIDER || "ECHO",
          hasOpenAI: !!env.OPENAI_API_KEY,
          hasCFAI: !!env.CF_AI_ACCOUNT_ID && !!env.CF_AI_TOKEN,
          lastUpdate: env.__LAST_UPDATE || null,
        });
      }
      if (req.method === "POST" && url.pathname === "/webhook") {
        // 1) Проста перевірка секрету
        const secret = req.headers.get("x-telegram-bot-api-secret-token") || "";
        if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) {
          return plain(403, "Forbidden");
        }

        // 2) Розбір апдейта
        let update;
        try {
          update = await req.json();
        } catch {
          return plain(400, "Bad JSON");
        }

        // 3) Обробка у фоновій задачі (відповідь Telegram швидко — 200 OK)
        ctx.waitUntil(handleUpdate(update, env).catch(console.error));

        env.__LAST_UPDATE = Date.now();
        return json(200, { ok: true });
      }

      return plain(404, "Not found");
    } catch (e) {
      console.error("Top-level error:", e);
      return plain(500, "Internal error");
    }
  },
};

/* ===================== Telegram helpers ===================== */

const tgBase = (token) => `https://api.telegram.org/bot${token}`;
const tgFileBase = (token) => `https://api.telegram.org/file/bot${token}`;

async function tgCall(env, method, payload) {
  const url = `${tgBase(env.TELEGRAM_BOT_TOKEN)}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await safeText(res);
    throw new Error(`TG ${method} ${res.status}: ${t}`);
  }
  return res.json();
}

async function tgTyping(env, chat_id, action = "typing") {
  try {
    await tgCall(env, "sendChatAction", { chat_id, action });
  } catch (e) {
    console.warn("sendChatAction warn:", e.message);
  }
}

/* ===================== Update router ===================== */

async function handleUpdate(update, env) {
  // message або edited_message або channel_post — беремо message, якщо є
  const msg = update.message || update.edited_message || update.channel_post;
  if (!msg) return;

  const chatId = msg.chat?.id;
  if (!chatId) return;

  // Команди
  const text = msg.text || msg.caption || "";
  if (text.startsWith("/start")) {
    await tgCall(env, "sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text:
        "Привіт! Я <b>Senti</b> 🤖\n" +
        "Надішли мені повідомлення або фото — проаналізую і відповім.\n\n" +
        "Команди: /start, /ping",
    });
    return;
  }
  if (text.startsWith("/ping")) {
    await tgCall(env, "sendMessage", {
      chat_id: chatId,
      text: "pong 🏓",
    });
    return;
  }

  // Фото
  if (Array.isArray(msg.photo) && msg.photo.length) {
    await tgTyping(env, chatId, "upload_photo");
    try {
      const best = msg.photo.reduce((a, b) => (a.file_size > b.file_size ? a : b));
      const fileB64 = await downloadTelegramFileAsBase64(env, best.file_id);
      const userPrompt =
        "Проаналізуй це зображення. Коротко, по суті. Якщо є текст — процитуй. Якщо є об’єкти — назви.";
      const ai = await aiVision(env, { imageBase64: fileB64, prompt: userPrompt, userText: text });

      await tgCall(env, "sendMessage", {
        chat_id: chatId,
        parse_mode: "Markdown",
        text: ai || "Не вдалося проаналізувати зображення.",
        reply_to_message_id: msg.message_id,
      });
    } catch (e) {
      console.error("photo err:", e);
      await tgCall(env, "sendMessage", {
        chat_id: chatId,
        text: "На жаль, не вдалося обробити фото (помилка аналізу).",
      });
    }
    return;
  }

  // Документи / стикери / голосові — просто ехо-інфо
  if (msg.document || msg.voice || msg.audio || msg.video || msg.sticker) {
    await tgCall(env, "sendMessage", {
      chat_id: chatId,
      text: "Я отримав файл 🙌 — зараз найкраще вмію працювати з фото та текстом.",
      reply_to_message_id: msg.message_id,
    });
    return;
  }

  // Текст — аналіз
  if (text) {
    await tgTyping(env, chatId, "typing");
    try {
      const ai = await aiText(env, {
        prompt:
          "Відповідай коротко, по суті, дружньо. Якщо є твердження — наведи 1–2 факти/кроки.",
        userText: text,
      });
      await tgCall(env, "sendMessage", {
        chat_id: chatId,
        parse_mode: "Markdown",
        text: ai || `echo: ${text}`,
        reply_to_message_id: msg.message_id,
      });
    } catch (e) {
      console.error("text err:", e);
      await tgCall(env, "sendMessage", {
        chat_id: chatId,
        text: `echo: ${text}`,
      });
    }
  }
}

/* ===================== Telegram file download ===================== */

async function downloadTelegramFileAsBase64(env, file_id) {
  // 1) getFile
  const resMeta = await fetch(`${tgBase(env.TELEGRAM_BOT_TOKEN)}/getFile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id }),
  });
  const meta = await resMeta.json();
  if (!meta.ok) throw new Error("getFile failed");
  const path = meta.result.file_path;
  if (!path) throw new Error("file_path missing");

  // 2) download file
  const url = `${tgFileBase(env.TELEGRAM_BOT_TOKEN)}/${path}`;
  const bin = await fetchWithTimeout(url, { timeoutMs: 20000 });
  if (!bin.ok) {
    const t = await safeText(bin);
    throw new Error(`download ${bin.status}: ${t}`);
  }
  const arr = new Uint8Array(await bin.arrayBuffer());
  return toBase64(arr);
}

/* ===================== AI Adapters ===================== */

async function aiText(env, { prompt, userText }) {
  const provider = (env.AI_PROVIDER || "").toUpperCase();
  if (provider === "CLOUDFLARE" && env.CF_AI_ACCOUNT_ID && env.CF_AI_TOKEN) {
    const model = env.CF_AI_TEXT_MODEL || "llama-3.1-8b-instruct";
    return cfAiText(env, model, prompt, userText);
  }
  if (provider === "OPENAI" && env.OPENAI_API_KEY) {
    const model = env.OPENAI_TEXT_MODEL || "gpt-4o-mini";
    return openAiText(env, model, prompt, userText);
  }
  // Fallback: echo+lite
  return simpleRewrite(userText);
}

async function aiVision(env, { imageBase64, prompt, userText }) {
  const provider = (env.AI_PROVIDER || "").toUpperCase();
  if (provider === "CLOUDFLARE" && env.CF_AI_ACCOUNT_ID && env.CF_AI_TOKEN) {
    const model = env.CF_AI_VISION_MODEL || "llava-1.5-7b-hf";
    return cfAiVision(env, model, prompt, userText, imageBase64);
  }
  if (provider === "OPENAI" && env.OPENAI_API_KEY) {
    const model = env.OPENAI_VISION_MODEL || "gpt-4o-mini";
    return openAiVision(env, model, prompt, userText, imageBase64);
  }
  // Fallback: без ШІ
  return "Отримав фото. Щоб увімкнути аналіз зображень — додай AI секрети до Worker.";
}

/* ---- Cloudflare Workers AI (REST) ---- */

async function cfAiText(env, model, systemPrompt, userText) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_AI_ACCOUNT_ID}/ai/run/@cf/${model}`;
  const body = {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText },
    ],
  };
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CF_AI_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    timeoutMs: 25000,
  });
  if (!res.ok) throw new Error(`CF AI text ${res.status}: ${await safeText(res)}`);
  const data = await res.json();
  const content =
    data?.result?.response ||
    data?.result?.message?.content ||
    data?.result?.choices?.[0]?.message?.content ||
    "";
  return tidy(content);
}

async function cfAiVision(env, model, systemPrompt, userText, imageBase64) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_AI_ACCOUNT_ID}/ai/run/@cf/${model}`;
  const body = {
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: userText || "Проаналізуй зображення." },
          { type: "image", image: imageBase64 },
        ],
      },
    ],
  };
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CF_AI_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    timeoutMs: 35000,
  });
  if (!res.ok) throw new Error(`CF AI vision ${res.status}: ${await safeText(res)}`);
  const data = await res.json();
  const content =
    data?.result?.response ||
    data?.result?.message?.content ||
    data?.result?.choices?.[0]?.message?.content ||
    "";
  return tidy(content);
}

/* ---- OpenAI (Chat Completions) ---- */

async function openAiText(env, model, systemPrompt, userText) {
  const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
      temperature: 0.5,
      max_tokens: 400,
    }),
    timeoutMs: 25000,
  });
  if (!res.ok) throw new Error(`OpenAI text ${res.status}: ${await safeText(res)}`);
  const data = await res.json();
  return tidy(data?.choices?.[0]?.message?.content || "");
}

async function openAiVision(env, model, systemPrompt, userText, imageBase64) {
  const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userText || "Проаналізуй зображення." },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
            },
          ],
        },
      ],
      temperature: 0.4,
      max_tokens: 500,
    }),
    timeoutMs: 35000,
  });
  if (!res.ok) throw new Error(`OpenAI vision ${res.status}: ${await safeText(res)}`);
  const data = await res.json();
  return tidy(data?.choices?.[0]?.message?.content || "");
}

/* ===================== Utils ===================== */

function plain(status, body) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return "<no-text>";
  }
}

function toBase64(uint8) {
  // Workers: btoa expects string; перетворимо на binary string
  let s = "";
  for (let i = 0; i < uint8.length; i++) s += String.fromCharCode(uint8[i]);
  return btoa(s);
}

function tidy(s) {
  return (s || "").trim().replace(/\n{3,}/g, "\n\n");
}

function simpleRewrite(txt) {
  if (!txt) return "";
  const t = txt.trim();
  if (t.length <= 3) return t;
  // легкий "покращувач"
  return t.length > 500 ? t.slice(0, 480) + "…" : t;
}

async function fetchWithTimeout(url, opts = {}) {
  const { timeoutMs = 20000, ...rest } = opts;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}