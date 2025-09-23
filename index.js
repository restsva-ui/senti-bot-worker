/**
 * Senti Telegram bot on Cloudflare Workers
 * - AI provider routing via env.AI_PROVIDERS = "text:gemini,deepseek;vision:gemini"
 * - Fallback chain (first success wins)
 * - Vision (photo) via Gemini 1.5 Flash (inline base64)
 * - Webhook secret check
 * - Typing indicator while thinking
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health-check
    if (request.method === "GET" && (path === "/" || path === "/health")) {
      return new Response("ok");
    }

    // Webhook endpoints (support both /webhook and any custom suffix)
    const isWebhookPath =
      path === "/webhook" ||
      // allow any custom path you used when setting webhook (e.g. /senti1984)
      /^\/[a-zA-Z0-9\-_]{4,64}$/.test(path);

    if (request.method === "POST" && isWebhookPath) {
      // 1) Verify Telegram secret (protection from spoofed calls)
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (!secret || secret !== env.WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }

      // 2) Parse update
      const update = await request.json().catch(() => ({}));
      if (!update || !update.message) {
        return new Response("no message", { status: 200 });
      }

      try {
        await handleUpdate(update, env, ctx);
        return new Response("ok");
      } catch (e) {
        console.error("Handler error:", e);
        // Не ламаємо вебхук — повертаємо 200, щоб Телеграм не відрізав
        return new Response("ok");
      }
    }

    return new Response("not found", { status: 404 });
  },
};

// --------------------------- Telegram helpers ---------------------------

async function sendTyping(chatId, env, action = "typing") {
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("action", action);
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendChatAction`, {
    method: "POST",
    body: form,
  }).catch(() => {});
}

async function sendMessage(chatId, text, env, extra = {}) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...extra,
  };
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function sendPhoto(chatId, fileUrl, caption, env) {
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("photo", fileUrl);
  if (caption) form.set("caption", caption);
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendPhoto`, {
    method: "POST",
    body: form,
  });
}

async function getFileUrl(fileId, env) {
  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/getFile?file_id=${encodeURIComponent(
      fileId
    )}`
  );
  const data = await res.json();
  if (!data.ok) throw new Error("Failed to getFile");
  const path = data.result.file_path;
  return `https://api.telegram.org/file/bot${env.TELEGRAM_TOKEN}/${path}`;
}

// --------------------------- Update handler ---------------------------

async function handleUpdate(update, env, ctx) {
  const msg = update.message;
  const chatId = msg.chat.id;

  // Show typing while we process
  ctx.waitUntil(
    (async () => {
      await sendTyping(chatId, env, "typing");
    })()
  );

  // /start
  if (msg.text && /^\/start\b/i.test(msg.text)) {
    await sendMessage(
      chatId,
      "Привіт! Надішли текст або фото — я відповім 🤖",
      env
    );
    return;
  }

  // Photo (vision)
  if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
    const largest = msg.photo[msg.photo.length - 1]; // biggest size
    const fileId = largest.file_id;
    const fileUrl = await getFileUrl(fileId, env);
    // try to caption with user's message if present
    const userPrompt = msg.caption || "Опиши це зображення українською.";

    await sendTyping(chatId, env, "upload_photo");
    const answer = await aiVisionDescribe(fileUrl, userPrompt, env);
    await sendMessage(chatId, answer, env);
    return;
  }

  // Text
  if (msg.text) {
    const userText = msg.text.trim();

    // Simple guardrails / small intents
    if (/^\/setwebhook/i.test(userText)) {
      await sendMessage(
        chatId,
        "Вебхук уже налаштований з GitHub Actions. Все працює ✅",
        env
      );
      return;
    }

    // AI answer with fallback chain
    const answer = await aiTextAnswer(userText, env);
    await sendMessage(chatId, answer, env);
    return;
  }

  // Fallback for unsupported update
  await sendMessage(chatId, "Поки що розумію лише текст та фото 🙌", env);
}

// --------------------------- Provider routing ---------------------------

function parseProviders(env) {
  // Example: "text:gemini,deepseek;vision:gemini"
  const cfg = (env.AI_PROVIDERS || "").trim();
  const out = { text: [], vision: [] };

  cfg.split(";").forEach((segment) => {
    const [kindRaw, listRaw] = segment.split(":");
    if (!kindRaw || !listRaw) return;
    const kind = kindRaw.trim().toLowerCase();
    const models = listRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    if (kind === "text") out.text.push(...models);
    if (kind === "vision") out.vision.push(...models);
  });

  // Sensible defaults if empty
  if (out.text.length === 0) out.text = ["gemini"];
  if (out.vision.length === 0) out.vision = ["gemini"];

  return out;
}

// --------------------------- AI text (with fallback) ---------------------------

async function aiTextAnswer(prompt, env) {
  const providers = parseProviders(env).text;

  const errors = [];
  for (const name of providers) {
    try {
      if (name === "gemini") {
        if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");
        return await geminiText(prompt, env);
      }
      if (name === "deepseek") {
        if (!env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY missing");
        return await deepseekText(prompt, env);
      }
      // unknown keyword -> skip
    } catch (e) {
      errors.push(`${name}: ${e.message || e}`);
    }
  }

  // If got here, all failed
  console.error("All text providers failed:", errors.join(" | "));
  return "Вибач, зараз не можу відповісти. Спробуй ще раз трохи пізніше 🙏";
}

// --------------------------- AI vision (Gemini) ---------------------------

async function aiVisionDescribe(imageUrl, userPrompt, env) {
  // Vision зараз через Gemini 1.5 (inline base64)
  if (!env.GEMINI_API_KEY) {
    return "Для аналізу зображень потрібен GEMINI_API_KEY — звернися до адміністратора.";
  }

  // Fetch & base64 the image
  const { base64, mime } = await fetchAsBase64(imageUrl);

  const prompt =
    userPrompt && userPrompt.length > 1
      ? userPrompt
      : "Опиши зображення коротко та по суті українською.";

  const res = await geminiGenerateContent(
    [
      { text: prompt },
      {
        inlineData: {
          mimeType: mime || "image/jpeg",
          data: base64,
        },
      },
    ],
    env
  );

  const text = extractGeminiText(res);
  return text || "Не вдалося інтерпретувати зображення 😔";
}

async function fetchAsBase64(url) {
  const resp = await fetch(url);
  const buf = await resp.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  // naive mime inference
  const ct = resp.headers.get("content-type") || "";
  let mime = "image/jpeg";
  if (ct.startsWith("image/")) mime = ct.split(";")[0];
  return { base64: b64, mime };
}

// --------------------------- Provider: Gemini ---------------------------

async function geminiText(prompt, env) {
  const res = await geminiGenerateContent([{ text: prompt }], env);
  const text = extractGeminiText(res);
  if (!text) throw new Error("Gemini empty");
  return text.trim();
}

function extractGeminiText(apiResponse) {
  try {
    const parts =
      apiResponse?.candidates?.[0]?.content?.parts ??
      apiResponse?.candidates?.[0]?.content?.parts ??
      [];
    const firstText =
      parts.find((p) => typeof p.text === "string")?.text ||
      apiResponse?.candidates?.[0]?.content?.parts?.[0]?.text ||
      apiResponse?.candidates?.[0]?.content?.parts?.map?.((p) => p.text).join("\n");
    return firstText || "";
  } catch {
    return "";
  }
}

async function geminiGenerateContent(parts, env) {
  // Using gemini-1.5-flash (fast & free tier)
  const model = "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
    env.GEMINI_API_KEY
  )}`;

  const body = {
    contents: [{ role: "user", parts }],
    // you may tune safety / generationConfig if needed
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Gemini HTTP ${resp.status} ${t}`);
  }
  return await resp.json();
}

// --------------------------- Provider: DeepSeek ---------------------------

async function deepseekText(prompt, env) {
  const url = "https://api.deepseek.com/chat/completions";
  const body = {
    model: "deepseek-chat",
    messages: [{ role: "user", content: prompt }],
    stream: false,
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`DeepSeek HTTP ${resp.status} ${t}`);
  }

  const data = await resp.json();
  const text =
    data?.choices?.[0]?.message?.content ||
    data?.choices?.[0]?.delta?.content ||
    "";
  if (!text) throw new Error("DeepSeek empty");
  return text.trim();
}