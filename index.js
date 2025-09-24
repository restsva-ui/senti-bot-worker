// ========== Senti — Cloudflare Worker (Telegram bot) ==========

const TG_API = (token) => `https://api.telegram.org/bot${token}`;
const TG_FILE = (token) => `https://api.telegram.org/file/bot${token}`;

// ---------- Helpers ----------
const json = (status, data) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const b64 = (buf) =>
  typeof buf === "string"
    ? btoa(buf)
    : btoa(String.fromCharCode(...new Uint8Array(buf)));

function nowISO() {
  return new Date().toISOString();
}

// ---------- Upstash Redis (REST) ----------
async function redisSet(env, key, value, ttlSec = 60 * 60 * 24 * 3) {
  // JSON-рядок з ресурсами
  const body = JSON.stringify(value);
  const url = `${env.REDIS_URL}/set/${encodeURIComponent(key)}?EX=${ttlSec}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body,
  });
  if (!r.ok) throw new Error(`Redis set failed: ${r.status}`);
}

async function redisGet(env, key) {
  const url = `${env.REDIS_URL}/get/${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${env.REDIS_TOKEN}` },
  });
  if (!r.ok) return null;
  const data = await r.json(); // { result: "..." } | { result: null }
  if (!data || data.result == null) return null;
  try {
    return JSON.parse(data.result);
  } catch {
    return data.result;
  }
}

async function loadHistory(env, chatId) {
  const key = `chat:${chatId}:history`;
  const arr = (await redisGet(env, key)) || [];
  return Array.isArray(arr) ? arr : [];
}

async function pushHistory(env, chatId, role, content, max = 10) {
  const key = `chat:${chatId}:history`;
  const hist = (await loadHistory(env, chatId)) || [];
  hist.push({ role, content, ts: nowISO() });
  while (hist.length > max) hist.shift();
  await redisSet(env, key, hist);
  return hist;
}

// ---------- Telegram API ----------
async function tgSendAction(env, chatId, action = "typing") {
  await fetch(`${TG_API(env.TELEGRAM_TOKEN)}/sendChatAction`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action }),
  });
}

async function tgSendMessage(env, chatId, text, replyTo) {
  return fetch(`${TG_API(env.TELEGRAM_TOKEN)}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      reply_to_message_id: replyTo,
    }),
  });
}

async function tgSendPhoto(env, chatId, fileOrUrl, caption) {
  // fileOrUrl може бути URL або data: URI
  return fetch(`${TG_API(env.TELEGRAM_TOKEN)}/sendPhoto`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      photo: fileOrUrl,
      caption,
    }),
  });
}

async function tgGetFile(env, fileId) {
  const r = await fetch(`${TG_API(env.TELEGRAM_TOKEN)}/getFile?file_id=${fileId}`);
  const j = await r.json();
  if (!j.ok) throw new Error("getFile failed");
  return `${TG_FILE(env.TELEGRAM_TOKEN)}/${j.result.file_path}`;
}
// ---------- AI Gateway ----------
async function aiGateway(env, model, payload) {
  const url = `${env.CF_AI_GATEWAY_BASE}/workers-ai/${encodeURIComponent(model)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`AI ${model} ${r.status}: ${t}`);
  }
  return r.json();
}

const CF_TEXT_FALLBACK = "@cf/llama-3.1-8b-instruct";
const CF_VISION_FALLBACK = "@cf/llava-1.5-7b";

// messages → [{role, content}] | [{role, content:[{type:'input_text',text},...] }]
async function askText(env, messages) {
  try {
    // головна спроба (через gateway; якщо прописав Gemini у gateway — піде туди)
    const res = await aiGateway(env, CF_TEXT_FALLBACK, { messages });
    // у Workers AI відповіді бувають у різних ключах; нормалізуємо
    const text =
      res?.response ??
      res?.result ??
      res?.choices?.[0]?.message?.content ??
      res?.output_text ??
      JSON.stringify(res);
    return String(text).trim();
  } catch (e) {
    return "Вибач, зараз я недоступний. Спробуй, будь ласка, ще раз пізніше.";
  }
}

async function askVision(env, prompt, imageBytes) {
  // Будуємо multimodal контент для Workers AI (llava)
  const content = [
    { type: "input_text", text: prompt || "Опиши зображення українською." },
    { type: "input_image", image: b64(imageBytes) },
  ];
  try {
    const res = await aiGateway(env, CF_VISION_FALLBACK, {
      messages: [{ role: "user", content }],
    });
    const text =
      res?.response ??
      res?.result ??
      res?.choices?.[0]?.message?.content ??
      res?.output_text ??
      JSON.stringify(res);
    return String(text).trim();
  } catch (e) {
    return "Я отримав фото, але тимчасово не можу його розпізнати. Спробуй надіслати ще раз.";
  }
}

// ---------- Роутер ----------
async function handleTelegramUpdate(env, update) {
  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const msgId = msg.message_id;
  const name =
    msg.from?.first_name ||
    msg.from?.username ||
    "користувач";

  // Індикація "друкую…"
  tgSendAction(env, chatId, "typing").catch(() => {});

  // Привітання /start
  if (msg.text && /^\/start\b/i.test(msg.text)) {
    await tgSendMessage(
      env,
      chatId,
      "Привіт! Надішли текст чи *фото* — я відповім 🤖\n\n" +
        "Щоб згенерувати зображення: напиши `/imagine` або `img:` і опис (фіча в розробці).",
      msgId
    );
    return;
  }

  // Фото
  if (msg.photo && msg.photo.length) {
    // беремо найбільше фото
    const best = msg.photo[msg.photo.length - 1];
    try {
      const fileUrl = await tgGetFile(env, best.file_id);
      const imgResp = await fetch(fileUrl);
      const bytes = new Uint8Array(await imgResp.arrayBuffer());

      const hist = await loadHistory(env, chatId);
      const userPrompt = msg.caption?.trim() || "";
      const sys = "Ти корисний візуальний помічник. Коротко та чітко опиши, що на фото, українською. За можливості додай 2–3 висновки списком.";

      const answer = await askVision(env, `${sys}\n\n${userPrompt}`, bytes);
      await pushHistory(env, chatId, "user", "[image]");
      await pushHistory(env, chatId, "assistant", answer);
      await tgSendMessage(env, chatId, answer, msgId);
    } catch (e) {
      await tgSendMessage(env, chatId, "Не вдалося завантажити фото 😅", msgId);
    }
    return;
  }

  // Текст
  if (msg.text) {
    const text = msg.text.trim();

    // Проста навчена відповідь на валюту (без інтернету)
    if (/курс\s+долара/i.test(text)) {
      await tgSendMessage(
        env,
        chatId,
        "Я не маю доступу до *онлайн-курсів* у реальному часі. Перевір, будь ласка, в застосунку банку або на сайті НБУ.",
        msgId
      );
      return;
    }

    const hist = await loadHistory(env, chatId);
    const system =
      "Ти — Senti, уважний і дружній асистент. " +
      "Відповідай українською, коротко й по суті, якщо не попросили інакше. " +
      "Якщо користувач поставить особисте питання — будь тактовним.";

    const messages = [
      { role: "system", content: system },
      ...hist.map((h) => ({ role: h.role, content: h.content })),
      { role: "user", content: text },
    ];

    const answer = await askText(env, messages);
    await pushHistory(env, chatId, "user", text);
    await pushHistory(env, chatId, "assistant", answer);

    await tgSendMessage(env, chatId, answer, msgId);
    return;
  }

  // Інші типи
  await tgSendMessage(env, chatId, "Надішли, будь ласка, текст або фото 🙌", msgId);
}

// ---------- Worker entry ----------
export default {
  async fetch(request, env) {
    // Healthcheck
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/health") {
      return json(200, { ok: true, service: "senti-bot", time: nowISO() });
    }

    // Приймаємо Telegram тільки з секретним заголовком
    if (request.method === "POST") {
      const sec = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (!sec || sec !== env.WEBHOOK_SECRET) {
        return json(401, { ok: false, error: "unauthorized" });
      }
      const update = await request.json().catch(() => ({}));
      // Обробляємо update, не падаємо при помилках
      try {
        await handleTelegramUpdate(env, update);
      } catch (e) {
        // Мовчазний лог (у безкоштовному тарифі Cloudflare логів мало)
      }
      return json(200, { ok: true });
    }

    return json(404, { ok: false, error: "Not Found" });
  },
};