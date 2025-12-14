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

function isNoEndpointsError(msg) {
  const m = String(msg || "").toLowerCase();
  return m.includes("no endpoints found");
}

function pickAdminToken(env) {
  // якщо у твоїх адмін-ендпойнтах є перевірка токена через query-параметр
  // використовуй TELEGRAM_SECRET_TOKEN (або WEBHOOK_SECRET як fallback)
  const t =
    env.TELEGRAM_SECRET_TOKEN ||
    env.WEBHOOK_SECRET ||
    env.TG_WEBHOOK_SECRET ||
    "";
  return String(t || "");
}

function adminUrl(env, path) {
  const base = abs(env, path);
  const tok = pickAdminToken(env);
  if (!tok) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}k=${encodeURIComponent(tok)}`;
}

function adminMenuText(lang) {
  if (lang === "ru") return "Админ-меню:";
  if (lang === "en") return "Admin menu:";
  return "Адмін-меню:";
}

function adminMenuKeyboard(env, lang) {
  // ВАЖЛИВО: тут тільки посилання. Якщо якогось ендпойнта немає — буде 404, але меню не ламається.
  // Підігнав під типові роутінги: /admin/brain, /admin/checklist, /admin/statut, /admin/energy, /admin/learn, /admin/repo, /admin/usage, /admin/nightly
  const L = (uk, ru, en) => (lang === "ru" ? ru : lang === "en" ? en : uk);

  const rows = [
    [
      { text: L("Brain", "Brain", "Brain"), url: adminUrl(env, "/admin/brain") },
      {
        text: L("Checklist", "Чеклист", "Checklist"),
        url: adminUrl(env, "/admin/checklist"),
      },
    ],
    [
      {
        text: L("Statut", "Статус", "Status"),
        url: adminUrl(env, "/admin/statut"),
      },
      {
        text: L("Energy", "Енергія", "Energy"),
        url: adminUrl(env, "/admin/energy"),
      },
    ],
    [
      { text: L("Learn", "Learn", "Learn"), url: adminUrl(env, "/admin/learn") },
      {
        text: L("Nightly", "Нічний агент", "Nightly agent"),
        url: adminUrl(env, "/admin/nightly"),
      },
    ],
    [
      { text: L("Repo", "Repo", "Repo"), url: adminUrl(env, "/admin/repo") },
      {
        text: L("Usage", "Usage", "Usage"),
        url: adminUrl(env, "/admin/usage"),
      },
    ],
  ];

  return { inline_keyboard: rows };
}

async function callOpenRouterSingle(env, lang, userText, model) {
  const base =
    env.FREE_API_BASE_URL || env.FREE_LLM_BASE_URL || "https://openrouter.ai/api";
  const path = env.FREE_API_PATH || "/v1/chat/completions";
  const key = env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY missing");

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort("timeout"), 25000);

  try {
    const r = await fetch(base + path, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "HTTP-Referer": env.OPENROUTER_SITE_URL || "https://senti.restsva.app",
        "X-Title": env.OPENROUTER_APP_NAME || "Senti Bot Worker",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: sysPrompt(lang) },
          { role: "user", content: userText },
        ],
        temperature: 0.6,
      }),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg =
        data?.error?.message || data?.message || `OpenRouter HTTP ${r.status}`;
      throw new Error(msg);
    }

    const out = data?.choices?.[0]?.message?.content;
    if (!out) throw new Error("OpenRouter empty response");
    return String(out).trim();
  } finally {
    clearTimeout(to);
  }
}

async function callOpenRouter(env, lang, userText) {
  // 1) якщо задано FREE_API_MODEL — він перший
  // 2) якщо задано FREE_API_MODELS — це фолбеки
  // 3) якщо нічого — беремо безпечні дефолти
  const primary =
    env.FREE_API_MODEL ||
    env.FREE_LLM_MODEL ||
    env.OPENROUTER_MODEL ||
    "google/gemma-3n-e4b-it:free";

  const fallbacks = parseCsvModels(env.FREE_API_MODELS);
  const candidates = [primary, ...fallbacks].filter(Boolean);

  const tried = [];
  let lastErr = null;

  for (const model of candidates) {
    tried.push(model);
    try {
      const text = await callOpenRouterSingle(env, lang, userText, model);
      if (diagOn(env)) return `${text}\n\n(diag: openrouter:${model})`;
      return text;
    } catch (e) {
      const msg = String(e?.message || e);
      lastErr = msg;

      if (isNoEndpointsError(msg)) continue;
      continue;
    }
  }

  const diag = diagOn(env)
    ? `\n\n(diag: openrouter failed; tried: ${tried.join(", ")}; last: ${String(
        lastErr || "unknown"
      )})`
    : "";

  if (lang === "ru")
    return `Сейчас у меня проблемы с OpenRouter. Попробуй позже.${diag}`;
  if (lang === "en")
    return `I have issues reaching OpenRouter right now. Please try again later.${diag}`;
  return `Зараз є проблеми з OpenRouter. Спробуй трохи пізніше.${diag}`;
}

async function callGemini(env, lang, userText) {
  // ✅ ФІКС: у тебе збережений GEMINI_API_KEY, а не GOOGLE_API_KEY
  const key = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.FREE_API_KEY;
  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
  if (!key) throw new Error("GEMINI_API_KEY (or GOOGLE_API_KEY) missing");

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort("timeout"), 25000);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(key)}`;

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
    if (diagOn(env)) return `${text}\n\n(diag: gemini:${model}; api=v1beta)`;
    return text;
  } finally {
    clearTimeout(to);
  }
}

async function answerWithAI(env, lang, userText) {
  // пріоритет: Gemini (якщо є ключ) → OpenRouter
  const errors = [];

  if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.FREE_API_KEY) {
    try {
      return await callGemini(env, lang, userText);
    } catch (e) {
      errors.push(String(e?.message || e));
    }
  }

  if (env.OPENROUTER_API_KEY) {
    const out = await callOpenRouter(env, lang, userText);
    return out;
  }

  const diag = diagOn(env)
    ? `\n\n(diag: ${errors.join(" | ") || "no providers"})`
    : "";

  if (lang === "ru")
    return `Сейчас у меня проблемы с AI-провайдерами. Попробуй позже.${diag}`;
  if (lang === "en")
    return `I have issues reaching AI providers right now. Please try again later.${diag}`;
  return `Зараз є проблеми з AI-провайдерами. Спробуй трохи пізніше.${diag}`;
}

function startText(lang, firstName) {
  if (lang === "ru")
    return `Привет, ${firstName || "друг"}! Я Senti.\nНапиши вопрос или отправь фото — я опишу его.`;
  if (lang === "en")
    return `Hi, ${firstName || "friend"}! I'm Senti.\nAsk a question or send a photo — I'll describe it.`;
  return `Привіт, ${firstName || "друже"}! Я Senti.\nНапиши питання або надішли фото — я опишу його.`;
}

function helloText(lang) {
  if (lang === "ru") return "Я тут. Напиши запрос или отправь фото.";
  if (lang === "en") return "I'm here. Send a query or a photo.";
  return "Я тут. Напиши запит або надішли фото.";
}

function codexText(lang) {
  if (lang === "ru")
    return "Codex сейчас в ремонте. Используй /voice или обычный чат.";
  if (lang === "en")
    return "Codex is under maintenance. Use /voice or normal chat.";
  return "Codex зараз у ремонті. Використовуй /voice або звичайний чат.";
}

function voiceText(lang) {
  if (lang === "ru")
    return "Голосовой режим: пришли голосовое сообщение (voice) или напиши текстом.";
  if (lang === "en")
    return "Voice mode: send a voice message or type text.";
  return "Voice-режим: надішли голосове повідомлення або напиши текстом.";
}
function driveText(env, lang, userId) {
  const link = abs(env, `/auth/start?u=${encodeURIComponent(String(userId || ""))}`);
  if (lang === "ru")
    return `Підключення Google Drive: <a href="${link}">Authorize</a>`;
  if (lang === "en")
    return `Connect Google Drive: <a href="${link}">Authorize</a>`;
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
    if (sec !== env.TG_WEBHOOK_SECRET)
      return json({ ok: false, error: "unauthorized" }, 401);
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

  const isAdmin =
    TG.ADMIN?.(env, msg?.from?.id, msg?.from?.username) || false;

  // /start → ставимо reply keyboard (щоб кнопки не зникали)
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
    await TG.sendMessage(
      chatId,
      voiceText(lang),
      { reply_markup: TG.mainKeyboard?.(isAdmin) },
      env
    );
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

  // ✅ РОУТИНГ ПО КНОПКАХ
  if (text === TG.BTN_SENTI) {
    await TG.sendMessage(
      chatId,
      helloText(lang),
      { reply_markup: TG.mainKeyboard?.(isAdmin) },
      env
    );
    return json({ ok: true });
  }

  if (text === TG.BTN_CODEX) {
    await TG.sendMessage(
      chatId,
      codexText(lang),
      { reply_markup: TG.mainKeyboard?.(isAdmin) },
      env
    );
    return json({ ok: true });
  }

  // ✅ ADMIN: повертаємо повний функціонал через меню з кнопками
  if (text === TG.BTN_ADMIN) {
    if (!isAdmin) {
      const m =
        lang === "ru"
          ? "Доступ запрещён."
          : lang === "en"
          ? "Access denied."
          : "Доступ заборонено.";
      await TG.sendMessage(
        chatId,
        m,
        { reply_markup: TG.mainKeyboard?.(isAdmin) },
        env
      );
      return json({ ok: true });
    }

    await TG.sendMessage(
      chatId,
      adminMenuText(lang),
      {
        reply_markup: adminMenuKeyboard(env, lang),
        parse_mode: env.TELEGRAM_PARSE_MODE || undefined,
      },
      env
    );
    return json({ ok: true });
  }

  if (text === TG.BTN_DRIVE) {
    await TG.sendMessage(
      chatId,
      driveText(env, lang, msg?.from?.id),
      {
        reply_markup: TG.mainKeyboard?.(isAdmin),
        parse_mode: env.TELEGRAM_PARSE_MODE || "HTML",
      },
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
      lang === "ru"
        ? "Напиши текстовый запрос."
        : lang === "en"
        ? "Send a text query."
        : "Напиши текстовий запит.",
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