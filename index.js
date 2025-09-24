// Senti — Cloudflare Worker (Telegram bot) with memory + multimodel routing
// TEXT: Gemini -> DeepSeek -> Workers AI (AI binding or Gateway)
// VISION: Gemini -> Workers AI LLaVA
// Memory: Upstash Redis (last 10 pairs)

// ───────────────────────────────── CONFIG ─────────────────────────────────
const TG_API = (t) => `https://api.telegram.org/bot${t}`;
const TG_FILE = (t) => `https://api.telegram.org/file/bot${t}`;

const GEMINI_TEXT_MODEL = "gemini-1.5-flash";
const GEMINI_VISION_MODEL = "gemini-1.5-flash";
const TIMEOUT_GEMINI_MS = 5000;   // 5s -> switch to DeepSeek/fallback
const TIMEOUT_DEEPSEEK_MS = 6000; // 6s

const MEMORY_TURNS = 10; // keep last 10 user/assistant pairs

const SYSTEM_TEXT = "Ти — Senti: лаконічний, дружній, точний. Відповідай українською, списками коли доречно.";
const SYSTEM_VISION = "Ти — Senti. Опиши зображення однією фразою, далі 3–5 спостережень, потім короткі висновки.";

const CF_TEXT_FALLBACK_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const CF_VISION_FALLBACK_MODEL = "@cf/llava-1.5-7b";

// ──────────────────────────────── UTILS ──────────────────────────────────
const json = (st, data) => new Response(JSON.stringify(data), {
  status: st,
  headers: { "content-type": "application/json; charset=utf-8" },
});
const nowISO = () => new Date().toISOString();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

async function withTimeout(promise, ms, label = "op") {
  const to = new Promise((_, rej) => setTimeout(() => rej(new Error(`${label}-timeout`)), ms));
  return Promise.race([promise, to]);
}

// ────────────────────────────── REDIS (Upstash) ──────────────────────────
async function rGet(env, key) {
  const r = await fetch(`${env.REDIS_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${env.REDIS_TOKEN}` },
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j || j.result == null) return null;
  try { return JSON.parse(j.result); } catch { return j.result; }
}
async function rSet(env, key, val, ttlSec = 3 * 24 * 60 * 60) {
  const r = await fetch(`${env.REDIS_URL}/set/${encodeURIComponent(key)}?EX=${ttlSec}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.REDIS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(val),
  });
  if (!r.ok) throw new Error(`redis-set ${r.status}`);
}
async function loadHist(env, chatId) {
  return (await rGet(env, `chat:${chatId}:hist`)) || [];
}
async function pushHist(env, chatId, role, content) {
  const key = `chat:${chatId}:hist`;
  const arr = await loadHist(env, chatId);
  arr.push({ role, content, ts: nowISO() });
  while (arr.length > MEMORY_TURNS * 2) arr.shift();
  await rSet(env, key, arr);
  return arr;
}

// ───────────────────────────── TELEGRAM API ──────────────────────────────
async function tgAction(env, chatId, action = "typing") {
  await fetch(`${TG_API(env.TELEGRAM_TOKEN)}/sendChatAction`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action }),
  }).catch(() => {});
}
async function tgSend(env, chatId, text, replyTo) {
  return fetch(`${TG_API(env.TELEGRAM_TOKEN)}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      reply_to_message_id: replyTo,
      disable_web_page_preview: true,
    }),
  });
}
async function tgEdit(env, chatId, messageId, text) {
  return fetch(`${TG_API(env.TELEGRAM_TOKEN)}/editMessageText`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }),
  });
}
async function tgGetFileUrl(env, fileId) {
  const meta = await fetch(`${TG_API(env.TELEGRAM_TOKEN)}/getFile?file_id=${fileId}`).then(r => r.json());
  if (!meta?.ok) throw new Error("getFile failed");
  return `${TG_FILE(env.TELEGRAM_TOKEN)}/${meta.result.file_path}`;
}

// ──────────────────────────────── AI: GEMINI ─────────────────────────────
async function geminiText(env, messages) {
  if (!env.GEMINI_API_KEY) throw new Error("gemini-no-key");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const contents = messages.map(m => ({
    role: m.role === "system" ? "user" : m.role, // Gemini не використовує 'system' у contents
    parts: [{ text: m.content }],
  }));

  const body = {
    system_instruction: { role: "system", parts: [{ text: SYSTEM_TEXT }] },
    contents,
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`gemini-http-${r.status}`);
  const j = await r.json();
  const parts = j?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p?.text || "").join("").trim();
  if (!text) throw new Error("gemini-empty");
  return text;
}

async function geminiVision(env, prompt, imageBytes, mime = "image/jpeg") {
  if (!env.GEMINI_API_KEY) throw new Error("gemini-no-key");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const body = {
    system_instruction: { role: "system", parts: [{ text: SYSTEM_VISION }] },
    contents: [{
      role: "user",
      parts: [
        { text: (prompt || "").trim() || "Проаналізуй фото за правилами вище." },
        { inline_data: { mime_type: mime, data: b64(imageBytes) } },
      ],
    }],
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`gemini-vis-http-${r.status}`);
  const j = await r.json();
  const parts = j?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p?.text || "").join("").trim();
  if (!text) throw new Error("gemini-vis-empty");
  return text;
}

// ─────────────────────────────── AI: DEEPSEEK ────────────────────────────
async function deepseekText(env, messages) {
  if (!env.DEEPSEEK_API_KEY) throw new Error("deepseek-no-key");
  const url = "https://api.deepseek.com/chat/completions";
  const body = {
    model: "deepseek-chat",
    messages: messages.map(m => ({ role: m.role === "system" ? "system" : m.role, content: m.content })),
    stream: false,
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`deepseek-http-${r.status}`);
  const j = await r.json();
  const out = j?.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error("deepseek-empty");
  return out;
}

// ─────────────────────── Workers AI fallback (AI or Gateway) ─────────────
async function aiGateway(env, model, payload) {
  if (!env.CF_AI_GATEWAY_BASE) throw new Error("no-gateway");
  const url = `${env.CF_AI_GATEWAY_BASE}/workers-ai/${encodeURIComponent(model)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(env.CF_API_TOKEN ? { Authorization: `Bearer ${env.CF_API_TOKEN}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`gateway-${model}-${r.status}`);
  return r.json();
}

async function workersTextFallback(env, messages) {
  // 1) Prefer local binding (faster)
  if (env.AI) {
    const res = await env.AI.run(CF_TEXT_FALLBACK_MODEL, { messages });
    const out = res?.response || res?.result || res?.output_text || "";
    if (out) return String(out).trim();
  }
  // 2) Fallback via Gateway (if configured)
  const j = await aiGateway(env, CF_TEXT_FALLBACK_MODEL, { messages });
  const out = j?.response || j?.result || j?.output_text || j?.choices?.[0]?.message?.content || "";
  if (!out) throw new Error("workers-text-empty");
  return String(out).trim();
}

async function workersVisionFallback(env, prompt, imageBytes) {
  const content = [
    { type: "input_text", text: (prompt || "Опиши зображення українською.") },
    { type: "input_image", image: b64(imageBytes) },
  ];
  if (env.AI) {
    const res = await env.AI.run(CF_VISION_FALLBACK_MODEL, {
      messages: [{ role: "user", content }],
    });
    const out = res?.response || res?.result || res?.output_text || "";
    if (out) return String(out).trim();
  }
  const j = await aiGateway(env, CF_VISION_FALLBACK_MODEL, {
    messages: [{ role: "user", content }],
  });
  const out = j?.response || j?.result || j?.output_text || j?.choices?.[0]?.message?.content || "";
  if (!out) throw new Error("workers-vis-empty");
  return String(out).trim();
}

// ─────────────────── High-level: askText/askVision with fallbacks ─────────
async function askTextLLM(env, messages) {
  // 1) Gemini (5s)
  try {
    return await withTimeout(geminiText(env, messages), TIMEOUT_GEMINI_MS, "gemini-text");
  } catch (_) {}
  // 2) DeepSeek (6s)
  try {
    return await withTimeout(deepseekText(env, messages), TIMEOUT_DEEPSEEK_MS, "deepseek-text");
  } catch (_) {}
  // 3) Workers AI (final fallback)
  try {
    return await workersTextFallback(env, messages);
  } catch (_) {}
  return "Вибач, я тимчасово недоступний. Спробуй ще раз пізніше.";
}

async function askVisionLLM(env, prompt, imageBytes) {
  // 1) Gemini Vision
  try {
    return await withTimeout(geminiVision(env, prompt, imageBytes), TIMEOUT_GEMINI_MS, "gemini-vision");
  } catch (_) {}
  // 2) Workers AI LLaVA (final)
  try {
    return await workersVisionFallback(env, prompt, imageBytes);
  } catch (_) {}
  return "Я отримав фото, але наразі не можу його розпізнати. Спробуй, будь ласка, ще раз.";
}

// ─────────────────────────── Telegram update handler ─────────────────────
async function handleUpdate(env, update) {
  const msg = update.message || update.edited_message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const replyTo = msg.message_id;

  // typing…
  tgAction(env, chatId, "typing").catch(() => {});

  // /start — живе привітання (6 варіантів + ім'я)
  if (msg.text && /^\/start\b/i.test(msg.text)) {
    const firstName = msg.from?.first_name || msg.from?.username || "друже";
    const variants = [
      `Привіт, ${firstName}! 🚀 Давай зробимо цей день трошки яскравішим.`,
      `Хей, ${firstName}! 😎 Я Senti. Що підкинути корисного?`,
      `Радий бачити, ${firstName}! ✨ Пиши, з чого почнемо.`,
      `Привіт-привіт, ${firstName}! 🙌 Я поруч. Текст чи фото — і поїхали.`,
      `${firstName}, привіт! 🧠 Готовий допомогти. Що в пріоритеті?`,
      `Вітаю, ${firstName}! 🔧 Сформуємо план або розберемо питання?`,
    ];
    const hi = variants[Math.floor(Math.random() * variants.length)]
      + `\n\n• Надішли текст — відповім лаконічно.\n• Пришли фото — опишу та дам висновки.`;
    await tgSend(env, chatId, hi, replyTo);
    return;
  }

  // Photo
  if (msg.photo && msg.photo.length) {
    const best = msg.photo[msg.photo.length - 1];
    try {
      const fileUrl = await tgGetFileUrl(env, best.file_id);
      const imgResp = await fetch(fileUrl);
      const bytes = new Uint8Array(await imgResp.arrayBuffer());
      const prompt = (msg.caption || "").trim();

      const hist = await loadHist(env, chatId);
      const sys = "Ти — Senti. Опиши зображення стисло, потім 2–4 висновки списком.";
      const answer = await askVisionLLM(env, `${sys}\n\n${prompt}`, bytes);

      await pushHist(env, chatId, "user", "[image]" + (prompt ? ` ${prompt}` : ""));
      await pushHist(env, chatId, "assistant", answer);
      await tgSend(env, chatId, answer, replyTo);
    } catch {
      await tgSend(env, chatId, "Не вдалося завантажити фото 😅", replyTo);
    }
    return;
  }

  // Text
  if (msg.text) {
    const userText = msg.text.trim();

    // простий гард на live-дані
    if (/курс\s+долара/i.test(userText)) {
      await tgSend(env, chatId, "Я не маю live-доступу до курсів. Перевір у банку або на сайті НБУ.", replyTo);
      return;
    }

    const hist = await loadHist(env, chatId);
    const system = "Ти — Senti, дружній і практичний асистент. Відповідай стисло, українською, по суті. Де доречно — 3–5 булітів.";
    const messages = [
      { role: "system", content: system },
      ...hist.map(h => ({ role: h.role, content: h.content })),
      { role: "user", content: userText },
    ];

    const answer = await askTextLLM(env, messages);
    await pushHist(env, chatId, "user", userText);
    await pushHist(env, chatId, "assistant", answer);
    await tgSend(env, chatId, answer, replyTo);
    return;
  }

  await tgSend(env, chatId, "Надішли, будь ласка, текст або фото 🙌", replyTo);
}

// ─────────────────────────────── Worker entry ────────────────────────────
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    // Health
    if (request.method === "GET" && (pathname === "/" || pathname === "/health")) {
      return json(200, { ok: true, service: "senti", time: nowISO() });
    }

    // Telegram webhook (any path) with secret header
    if (request.method === "POST") {
      const sec = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (!sec || sec !== env.WEBHOOK_SECRET) return json(401, { ok: false, error: "unauthorized" });

      let update;
      try { update = await request.json(); } catch { return json(400, { ok: false, error: "bad json" }); }

      try { await handleUpdate(env, update); } catch (_) {}
      return json(200, { ok: true });
    }

    return json(404, { ok: false, error: "not found" });
  },
};