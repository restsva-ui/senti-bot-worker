// src/routes/webhook.js
import { TG } from "../lib/tg.js";
import { json } from "../utils/http.js";
import { abs } from "../utils/url.js";
import { handlePhoto } from "../flows/handlePhoto.js";

function nowKyiv() {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

function pickLang(update) {
  const code =
    (update?.message?.from?.language_code ||
      update?.callback_query?.from?.language_code ||
      "").slice(0, 2).toLowerCase();

  if (["uk", "ru", "en", "de", "fr"].includes(code)) return code;
  return "uk";
}

function sysPrompt(lang) {
  if (lang === "ru") {
    return "Ты — Senti, полезный телеграм-бот. Отвечай коротко (2–5 предложений), по делу, без выдумок. Если не уверен — скажи, что не уверен.";
  }
  if (lang === "en") {
    return "You are Senti, a helpful Telegram bot. Reply concisely (2–5 sentences), factual, no fabrication. If uncertain, say you're not sure.";
  }
  return "Ти — Senti, корисний телеграм-бот. Відповідай коротко (2–5 речень), по суті, без вигадок. Якщо не впевнений — скажи, що не впевнений.";
}

function diagOn(env) {
  return String(env.DIAG_TAGS || "off").toLowerCase() === "on";
}

function parseCsvModels(s) {
  return String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

// Підміна “битих”/недоступних CF моделей на актуальну (env.CF_MODEL)
function normalizeModelCandidate(env, model) {
  const m = String(model || "").trim();
  if (!m) return m;

  // Якщо десь залишилась стара/недоступна модель — підміняємо
  if (m.includes("@cf/meta/llama-3.2-11b-instruct")) {
    return String(env.CF_MODEL || "@cf/meta/llama-3.1-8b-instruct");
  }
  return m;
}

async function callGeminiOnce(env, lang, userText, apiKey, apiVersion) {
  const model = env.GEMINI_MODEL || "gemini-2.5-flash";

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort("timeout"), 25000);

  try {
    const base = apiVersion === "v1" ? "https://generativelanguage.googleapis.com/v1" : "https://generativelanguage.googleapis.com/v1beta";
    const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const r = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: `${sysPrompt(lang)}\n\nЗапит користувача:\n${userText}` }],
          },
        ],
        generationConfig: { temperature: 0.6 },
      }),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data?.error?.message || `Gemini HTTP ${r.status}`;
      throw new Error(msg);
    }

    const out = data?.candidates?.[0]?.content?.parts
      ?.map((p) => p?.text)
      .filter(Boolean)
      .join("\n");

    if (!out) throw new Error("Gemini empty response");

    const text = String(out).trim();
    if (diagOn(env)) return `${text}\n\n(diag: gemini:${model}; api=${apiVersion})`;
    return text;
  } finally {
    clearTimeout(to);
  }
}

async function callGemini(env, lang, userText) {
  // Підтримуємо обидві назви ключів, бо у тебе зараз збережено GEMINI_API_KEY
  const key = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY/GOOGLE_API_KEY missing");

  // Пробуємо v1beta, а якщо API/модель не доступні там — пробуємо v1
  try {
    return await callGeminiOnce(env, lang, userText, key, "v1beta");
  } catch (e) {
    const msg = String(e?.message || e);
    // Часті кейси: model not found / method not found / permission / 404
    // У такому разі пробуємо v1
    return await callGeminiOnce(env, lang, userText, key, "v1");
  }
}

async function callCloudflareAI(env, lang, userText, model) {
  const m = normalizeModelCandidate(env, model) || String(env.CF_MODEL || "@cf/meta/llama-3.1-8b-instruct");

  if (!env.AI?.run) {
    throw new Error("CF AI binding missing (env.AI.run not found)");
  }

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort("timeout"), 25000);

  try {
    const data = await env.AI.run(
      m,
      {
        messages: [
          { role: "system", content: sysPrompt(lang) },
          { role: "user", content: userText },
        ],
      },
      { signal: ctrl.signal }
    );

    const out = data?.response || data?.result || data?.output_text;
    if (!out) throw new Error("CF AI empty response");

    const text = String(out).trim();
    if (diagOn(env)) return `${text}\n\n(diag: cf:${m})`;
    return text;
  } finally {
    clearTimeout(to);
  }
}

function getTextChain(env) {
  // Пріоритет: Gemini -> CF
  // Беремо chain із vars, якщо він є, і “нормалізуємо” CF модель.
  const raw =
    env.MODEL_ORDER_TEXT ||
    env.MODEL_ORDER ||
    `gemini:${env.GEMINI_MODEL || "gemini-2.5-flash"}, cf:${env.CF_MODEL || "@cf/meta/llama-3.1-8b-instruct"}`;

  const parts = String(raw)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  return parts.map((p) => {
    const [prov, ...rest] = p.split(":");
    const model = rest.join(":").trim();
    if (prov === "cf") return `cf:${normalizeModelCandidate(env, model)}`;
    return p;
  });
}

async function answerWithAI(env, lang, userText) {
  const chain = getTextChain(env);
  const tried = [];
  let lastErr = null;

  for (const item of chain) {
    const [prov, ...rest] = String(item).split(":");
    const model = rest.join(":").trim();

    tried.push(item);

    try {
      if (prov === "gemini") {
        // Gemini працює навіть без "model" у chain — model беремо з GEMINI_MODEL
        return await callGemini(env, lang, userText);
      }
      if (prov === "cf") {
        return await callCloudflareAI(env, lang, userText, model);
      }
    } catch (e) {
      lastErr = String(e?.message || e);
      continue;
    }
  }

  const diag = diagOn(env)
    ? `\n\n(diag: providers failed; tried: ${tried.join(", ")}; last: ${String(lastErr || "unknown")})`
    : "";

  if (lang === "ru") return `Сейчас у меня проблемы с AI-провайдерами. Попробуй позже.${diag}`;
  if (lang === "en") return `I have issues reaching AI providers right now. Please try again later.${diag}`;
  return `Зараз є проблеми з AI-провайдерами. Спробуй трохи пізніше.${diag}`;
}

function startText(lang, firstName) {
  if (lang === "ru") return `Привет, ${firstName || "друг"}! Я Senti.\nНапиши вопрос или отправь фото — я опишу его.`;
  if (lang === "en") return `Hi, ${firstName || "friend"}! I'm Senti.\nAsk a question or send a photo — I'll describe it.`;
  return `Привіт, ${firstName || "друже"}! Я Senti.\nНапиши питання або надішли фото — я опишу його.`;
}

function helloText(lang) {
  if (lang === "ru") return "Я тут. Напиши запрос или отправь фото.";
  if (lang === "en") return "I'm here. Send a query or a photo.";
  return "Я тут. Напиши запит або надішли фото.";
}

function codexText(lang) {
  if (lang === "ru") return "Codex сейчас в ремонте. Используй /voice или обычный чат.";
  if (lang === "en") return "Codex is under maintenance. Use /voice or normal chat.";
  return "Codex зараз у ремонті. Використовуй /voice або звичайний чат.";
}

function voiceText(lang) {
  if (lang === "ru") return "Голосовой режим: пришли голосовое сообщение (voice) или напиши текстом.";
  if (lang === "en") return "Voice mode: send a voice message or type text.";
  return "Voice-режим: надішли голосове повідомлення або напиши текстом.";
}

function adminText(env, lang) {
  // Ведемо одразу на робочий endpoint і додаємо секрет (показуємо тільки адміну)
  const s = env.WEBHOOK_SECRET ? `?s=${encodeURIComponent(env.WEBHOOK_SECRET)}` : "";
  const u = abs(env, `/admin/brain/snapshot${s}`);
  if (lang === "ru") return `Админ: ${u}`;
  if (lang === "en") return `Admin: ${u}`;
  return `Адмін: ${u}`;
}

function driveText(env, lang, userId) {
  const link = abs(env, `/auth/start?u=${encodeURIComponent(String(userId || ""))}`);
  if (lang === "ru") return `Підключення Google Drive: <a href="${link}">Authorize</a>`;
  if (lang === "en") return `Connect Google Drive: <a href="${link}">Authorize</a>`;
  return `Підключення Google Drive: <a href="${link}">Authorize</a>`;
}

export default async function webhook(req, env) {
  let update;
  try {
    update = await req.json();
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }

  // додаткова безпека
  if (env.TG_WEBHOOK_SECRET) {
    const sec = req.headers.get("x-telegram-bot-api-secret-token");
    if (sec !== env.TG_WEBHOOK_SECRET) return json({ ok: false, error: "unauthorized" }, 401);
  }

  const lang = pickLang(update);
  const msg = update?.message || update?.edited_message;
  const cq = update?.callback_query;

  // Callback (inline кнопки)
  if (cq?.id) {
    const chatId = cq?.message?.chat?.id;
    const data = String(cq?.data || "");

    try {
      await TG.answerCallbackQuery?.(cq.id, { text: "OK" }, env);
    } catch {}

    if (chatId) {
      if (data === "ping") {
        await TG.sendMessage(chatId, `✅ OK\n${nowKyiv()}`, {}, env);
        return json({ ok: true });
      }
      await TG.sendMessage(chatId, `🔘 ${data}`, {}, env);
    }
    return json({ ok: true });
  }

  if (!msg?.chat?.id) return json({ ok: true, note: "no message" });

  const chatId = msg.chat.id;
  const text = String(msg.text || "").trim();

  const isAdmin = TG.ADMIN?.(env, msg?.from?.id, msg?.from?.username) || false;

  // /start → reply keyboard
  if (text === "/start") {
    await TG.sendMessage(
      chatId,
      startText(lang, msg?.from?.first_name),
      {
        reply_markup: TG.mainKeyboard ? TG.mainKeyboard(isAdmin) : undefined,
        parse_mode: env.TELEGRAM_PARSE_MODE || undefined,
      },
      env
    );
    return json({ ok: true });
  }

  // швидкі команди
  if (/^\/voice$/i.test(text)) {
    await TG.sendMessage(chatId, voiceText(lang), { reply_markup: TG.mainKeyboard?.(isAdmin) }, env);
    return json({ ok: true });
  }

  // дата/час
  if (/^(дата|date)$/i.test(text)) {
    await TG.sendMessage(chatId, `📅 ${nowKyiv().split(",")[0]}`, {}, env);
    return json({ ok: true });
  }
  if (/^(час|time|время)$/i.test(text)) {
    await TG.sendMessage(chatId, `🕒 ${nowKyiv()}`, {}, env);
    return json({ ok: true });
  }

  // routing по кнопках
  if (text === TG.BTN_SENTI) {
    await TG.sendMessage(chatId, helloText(lang), { reply_markup: TG.mainKeyboard?.(isAdmin) }, env);
    return json({ ok: true });
  }

  if (text === TG.BTN_CODEX) {
    await TG.sendMessage(chatId, codexText(lang), { reply_markup: TG.mainKeyboard?.(isAdmin) }, env);
    return json({ ok: true });
  }

  if (text === TG.BTN_ADMIN) {
    await TG.sendMessage(
      chatId,
      adminText(env, lang),
      { reply_markup: TG.mainKeyboard?.(isAdmin), parse_mode: env.TELEGRAM_PARSE_MODE || undefined },
      env
    );
    return json({ ok: true });
  }

  if (text === TG.BTN_DRIVE) {
    await TG.sendMessage(
      chatId,
      driveText(env, lang, msg?.from?.id),
      { reply_markup: TG.mainKeyboard?.(isAdmin), parse_mode: env.TELEGRAM_PARSE_MODE || "HTML" },
      env
    );
    return json({ ok: true });
  }

  // Фото
  if (msg.photo) {
    try {
      await handlePhoto(env, msg, lang);
      return json({ ok: true });
    } catch (e) {
      const diag = diagOn(env) ? `\n(diag: ${String(e?.message || e)})` : "";
      const m =
        lang === "ru"
          ? `Не получилось обработать фото. Попробуй еще раз позже.${diag}`
          : lang === "en"
          ? `I couldn't process the photo. Please try again later.${diag}`
          : `Не вдалося обробити фото. Спробуй пізніше.${diag}`;
      await TG.sendMessage(chatId, m, {}, env);
      return json({ ok: true });
    }
  }

  // інше медіа
  if (msg.document || msg.video || msg.voice || msg.sticker) {
    const m =
      lang === "ru"
        ? "Медиа получено. Пока я обрабатываю только фото. Пришли фото как изображение."
        : lang === "en"
        ? "Media received. For now I process photos only. Please send an image."
        : "Медіа отримано. Поки що я обробляю лише фото. Надішли фото як зображення.";
    await TG.sendMessage(chatId, m, {}, env);
    return json({ ok: true });
  }

  // порожній текст
  if (!text) {
    await TG.sendMessage(
      chatId,
      lang === "ru" ? "Напиши текстовый запрос." : lang === "en" ? "Send a text query." : "Напиши текстовий запит.",
      {},
      env
    );
    return json({ ok: true });
  }

  // звичайний чат → AI
  const reply = await answerWithAI(env, lang, text);
  await TG.sendMessage(chatId, reply, { reply_markup: TG.mainKeyboard?.(isAdmin) }, env);

  return json({ ok: true });
}
