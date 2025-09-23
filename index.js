// index.js — Senti (Cloudflare Worker + Telegram)

// ====== Конфіг за замовчуванням та утиліти ======

const DEFAULTS = {
  SYSTEM_STYLE: `Ти — Senti: доброзичливий, лаконічний асистент.
Пиши простою мовою, без води. Коли доречно — давай короткі буліти.
Якщо є фото — спочатку коротко розкажи "що на зображенні", потім дай корисні висновки.`,
  TIMEOUT_MS: 55000, // тримаємо нижче за 60с таймаут CF
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

function text(body = "ok", status = 200, extra = {}) {
  return new Response(body, { status, headers: { "content-type": "text/plain", ...extra } });
}

function isCommand(msg, name) {
  if (!msg?.text) return false;
  const t = msg.text.trim();
  return t === `/${name}` || t.startsWith(`/${name} `);
}

function extractArg(msg, name) {
  if (!msg?.text) return "";
  return msg.text.replace(new RegExp(`^/${name}\\s*`), "").trim();
}

// Короткий "таєпінг"/"завантаження" індикатор
async function tgAction(env, chatId, action) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendChatAction`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action }),
  });
}

// Відправка тексту
async function tgSend(env, chatId, text, replyTo) {
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_to_message_id: replyTo,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
}

// Редагування повідомлення
async function tgEdit(env, chatId, messageId, text) {
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/editMessageText`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
}

// Надіслати фото як файл (buffer/blob)
async function tgPhoto(env, chatId, blob, caption) {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("photo", new File([blob], "senti.png", { type: "image/png" }));
  if (caption) form.append("caption", caption);
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendPhoto`, {
    method: "POST",
    body: form,
  });
}

// Завантажити файл Telegram (jpg/png/webp)
async function fetchTelegramFile(env, fileId) {
  // 1) дізнатись шлях
  const meta = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/getFile?file_id=${fileId}`).then(r => r.json());
  const path = meta?.result?.file_path;
  if (!path) throw new Error("Cannot resolve Telegram file_path");
  // 2) стягнути файл
  const url = `https://api.telegram.org/file/bot${env.TELEGRAM_TOKEN}/${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return res.arrayBuffer();
}

// Безпечна Base64 (для Gemini vision)
function toBase64(ab) {
  const bytes = new Uint8Array(ab);
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str);
}

// Парсинг YAML-подібного списку провайдерів з env.AI_PROVIDERS
function parseProviders(env) {
  // формат: "text:gemini,workers-llama;vision:gemini,workers-vision;image:sdxl,flux"
  const conf = { text: ["gemini", "workers-llama"], vision: ["gemini", "workers-vision"], image: ["sdxl", "flux"] };
  const raw = env.AI_PROVIDERS || "";
  for (const seg of raw.split(";")) {
    const [k, v] = seg.split(":").map(s => s?.trim());
    if (!k || !v) continue;
    conf[k] = v.split(",").map(s => s.trim()).filter(Boolean);
  }
  return conf;
}
// ====== Провайдери AI ======

// 1) Gemini 1.5 Flash / Vision (прямий виклик Google; безкоштовні квоти)
async function geminiText(env, prompt) {
  if (!env.GEMINI_API_KEY) throw new Error("No GEMINI_API_KEY");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    system_instruction: { role: "system", parts: [{ text: DEFAULTS.SYSTEM_STYLE }] },
  };
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  const txt = j?.candidates?.[0]?.content?.parts?.map(p => p.text).join("")?.trim();
  if (!txt) throw new Error("Gemini text empty");
  return txt;
}

async function geminiVision(env, prompt, imageBytes, mime = "image/png") {
  if (!env.GEMINI_API_KEY) throw new Error("No GEMINI_API_KEY");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
  const body = {
    contents: [{
      role: "user",
      parts: [
        { text: `${DEFAULTS.SYSTEM_STYLE}\n\nКористувач: ${prompt || "Опиши це зображення та дай корисні висновки."}` },
        { inline_data: { mime_type: mime, data: toBase64(imageBytes) } }
      ]
    }]
  };
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  const txt = j?.candidates?.[0]?.content?.parts?.map(p => p.text).join("")?.trim();
  if (!txt) throw new Error("Gemini vision empty");
  return txt;
}

// 2) Workers AI через AI Gateway — текст (Llama 3.1 8B)
async function workersLlamaText(env, prompt) {
  const base = env.CF_AI_GATEWAY_BASE;
  if (!base) throw new Error("No CF_AI_GATEWAY_BASE");
  const url = `${base}/workers-ai/@cf/meta/llama-3.1-8b-instruct`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: prompt }),
  });
  const j = await r.json();
  const txt = j?.result?.response?.trim() || j?.result?.output_text?.trim();
  if (!txt) throw new Error("Workers Llama text empty");
  return txt;
}

// 3) Workers AI Vision (Llama 3.2 Vision) — мультимодалка
async function workersVision(env, prompt, imageBytes, mime = "image/png") {
  const base = env.CF_AI_GATEWAY_BASE;
  if (!base) throw new Error("No CF_AI_GATEWAY_BASE");
  // Модель може називатися так:
  // @cf/meta/llama-3.2-11b-vision-instruct
  const url = `${base}/workers-ai/@cf/meta/llama-3.2-11b-vision-instruct`;
  // Більшість обгорток Workers AI приймають "input" як масив частин
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: DEFAULTS.SYSTEM_STYLE },
        {
          role: "user",
          content: [
            { type: "text", text: prompt || "Опиши зображення та зроби корисні висновки." },
            { type: "image", image: [...new Uint8Array(imageBytes)] } // бінар для vision моделей Workers AI
          ]
        }
      ]
    }),
  });
  const j = await r.json();
  const txt = j?.result?.response?.trim() || j?.result?.output_text?.trim();
  if (!txt) throw new Error("Workers Vision empty");
  return txt;
}

// 4) Генерація зображень: SDXL (основний) → FLUX.1 (фолбек)
async function workersImageSDXL(env, prompt) {
  const base = env.CF_AI_GATEWAY_BASE;
  if (!base) throw new Error("No CF_AI_GATEWAY_BASE");
  // Стабільні варіанти в каталозі Workers AI:
  // @cf/stabilityai/stable-diffusion-xl-base-1.0  (або lightning)
  const url = `${base}/workers-ai/@cf/stabilityai/stable-diffusion-xl-base-1.0`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const j = await r.json();
  // Шукаємо base64
  let b64 = j?.result?.image || j?.result?.images?.[0];
  if (!b64) throw new Error("SDXL: no image");
  // інколи приходить dataURL — приберемо префікс
  b64 = b64.replace(/^data:image\/\w+;base64,/, "");
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return new Blob([bin], { type: "image/png" });
}

async function workersImageFLUX(env, prompt) {
  const base = env.CF_AI_GATEWAY_BASE;
  if (!base) throw new Error("No CF_AI_GATEWAY_BASE");
  // FLUX.1 Schnell
  const url = `${base}/workers-ai/@cf/black-forest-labs/flux-1-schnell`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const j = await r.json();
  let b64 = j?.result?.image || j?.result?.images?.[0];
  if (!b64) throw new Error("FLUX: no image");
  b64 = b64.replace(/^data:image\/\w+;base64,/, "");
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return new Blob([bin], { type: "image/png" });
}// ====== Мультимодальний роутер ======

async function answerText(env, prompt) {
  const order = parseProviders(env).text; // напр. ["gemini","workers-llama"]
  const errs = [];
  for (const p of order) {
    try {
      if (p === "gemini") return await geminiText(env, prompt);
      if (p === "workers-llama") return await workersLlamaText(env, prompt);
    } catch (e) { errs.push(`${p}: ${e.message}`); }
  }
  throw new Error(`No text provider. ${errs.join(" | ")}`);
}

async function answerVision(env, prompt, imageBytes, mime) {
  const order = parseProviders(env).vision; // ["gemini","workers-vision"]
  const errs = [];
  for (const p of order) {
    try {
      if (p === "gemini") return await geminiVision(env, prompt, imageBytes, mime);
      if (p === "workers-vision") return await workersVision(env, prompt, imageBytes, mime);
    } catch (e) { errs.push(`${p}: ${e.message}`); }
  }
  throw new Error(`No vision provider. ${errs.join(" | ")}`);
}

async function generateImage(env, prompt) {
  const order = parseProviders(env).image; // ["sdxl","flux"]
  const errs = [];
  for (const p of order) {
    try {
      if (p === "sdxl") return await workersImageSDXL(env, prompt);
      if (p === "flux") return await workersImageFLUX(env, prompt);
    } catch (e) { errs.push(`${p}: ${e.message}`); }
  }
  throw new Error(`No image provider. ${errs.join(" | ")}`);
}

// ====== Telegram Webhook ======

async function handleUpdate(env, update) {
  const msg = update.message || update.edited_message;
  if (!msg) return;

  const chatId = msg.chat.id;

  // Команди
  if (isCommand(msg, "start")) {
    const hello = "Привіт! Надішли текст чи фото — я відповім 🤖\n\n" +
      "Щоб згенерувати зображення: на початку напиши <b>/imagine</b> або <b>img:</b>\n" +
      "Приклад: <code>/imagine неоновий ліс у тумані, кінематографічне світло</code>";
    await tgSend(env, chatId, hello, msg.message_id);
    return;
  }

  if (isCommand(msg, "help")) {
    const help = "Доступне:\n" +
      "• Текст → відповідь\n" +
      "• Фото → опис та висновки\n" +
      "• /imagine або img: … → генерація зображення (SDXL/FLUX)\n";
    await tgSend(env, chatId, help, msg.message_id);
    return;
  }

  // Генерація зображень
  let genPrompt = null;
  if (isCommand(msg, "imagine")) genPrompt = extractArg(msg, "imagine");
  else if (msg.text?.trim().toLowerCase().startsWith("img:")) genPrompt = msg.text.trim().slice(4).trim();

  if (genPrompt) {
    await tgAction(env, chatId, "upload_photo");
    const thinking = await (await tgSend(env, chatId, "🎨 Генерую зображення…", msg.message_id)).json();
    try {
      const blob = await generateImage(env, genPrompt);
      await tgPhoto(env, chatId, blob, `Готово ✅\nЗапит: ${genPrompt}`);
      // Підчистимо “думаю”
      await tgEdit(env, chatId, thinking.result.message_id, "✅ Готово");
    } catch (e) {
      await tgEdit(env, chatId, thinking.result.message_id, `❌ Не вдалося згенерувати: ${e.message}`);
    }
    return;
  }

  // Фото / зображення
  const photo = msg.photo?.at(-1); // найбільше
  if (photo?.file_id) {
    await tgAction(env, chatId, "typing");
    const tmp = await (await tgSend(env, chatId, "🧠 Дивлюсь на фото…", msg.message_id)).json();
    try {
      const ab = await fetchTelegramFile(env, photo.file_id);
      const res = await answerVision(env, msg.caption || "", ab, "image/jpeg");
      await tgEdit(env, chatId, tmp.result.message_id, res);
    } catch (e) {
      await tgEdit(env, chatId, tmp.result.message_id, `❌ Помилка аналізу зображення: ${e.message}`);
    }
    return;
  }

  // Звичайний текст
  if (msg.text) {
    await tgAction(env, chatId, "typing");
    const dots = await (await tgSend(env, chatId, "… думаю", msg.message_id)).json();
    try {
      const res = await answerText(env, msg.text.trim());
      await tgEdit(env, chatId, dots.result.message_id, res);
    } catch (e) {
      await tgEdit(env, chatId, dots.result.message_id, `❌ Помилка: ${e.message}`);
    }
  }
}

// ====== Маршрути Worker ======

export default {
  async fetch(request, env, ctx) {
    // Basic health
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") return text("ok");

    // Вебхук: будь-який шлях (ти вказав власний у setWebhook)
    if (request.method === "POST") {
      // 1) Перевірка Telegram secret header
      const recv = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (env.WEBHOOK_SECRET && recv !== env.WEBHOOK_SECRET) {
        return json({ ok: false, error: "bad secret" }, 401);
      }

      // 2) Прочитати апдейт
      let update = null;
      try {
        update = await request.json();
      } catch {
        return json({ ok: false, error: "bad json" }, 400);
      }

      // 3) Обробити з тайм-лімітом
      const p = handleUpdate(env, update);
      const res = await Promise.race([
        p.then(() => json({ ok: true })),
        new Promise(resolve => setTimeout(() => resolve(json({ ok: true, slow: true })), DEFAULTS.TIMEOUT_MS)),
      ]);
      return res;
    }

    return text("Not found", 404);
  }
};