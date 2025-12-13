// src/routes/webhook.js
import { TG } from "../lib/tg.js";
import { json } from "../utils/http.js";
import { handlePhoto } from "../flows/handlePhoto.js";
import { abs } from "../utils/url.js";

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

async function callOpenRouter(env, lang, userText) {
  const base = env.FREE_API_BASE_URL || env.FREE_LLM_BASE_URL || "https://openrouter.ai/api";
  const path = env.FREE_API_PATH || "/v1/chat/completions";
  const model = env.FREE_API_MODEL || env.FREE_LLM_MODEL || "meta-llama/llama-4-scout:free";
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
      const msg = data?.error?.message || data?.message || `OpenRouter HTTP ${r.status}`;
      throw new Error(msg);
    }
    const out = data?.choices?.[0]?.message?.content;
    if (!out) throw new Error("OpenRouter empty response");
    return String(out).trim();
  } finally {
    clearTimeout(to);
  }
}

async function callGemini(env, lang, userText) {
  const key = env.GOOGLE_API_KEY;
  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
  if (!key) throw new Error("GOOGLE_API_KEY missing");

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
    const out = data?.candidates?.[0]?.content?.parts?.map((p) => p?.text).filter(Boolean).join("\n");
    if (!out) throw new Error("Gemini empty response");
    return String(out).trim();
  } finally {
    clearTimeout(to);
  }
}

async function answerWithAI(env, lang, userText) {
  const preferGemini = String(env.MODEL_ORDER || "").includes("gemini:");
  const preferFree = String(env.MODEL_ORDER || "").includes("free:");
  const tryGeminiFirst = preferGemini || !preferFree;

  const errors = [];

  if (tryGeminiFirst) {
    try {
      if (env.GOOGLE_API_KEY) return await callGemini(env, lang, userText);
    } catch (e) {
      errors.push(String(e?.message || e));
    }
    try {
      if (env.OPENROUTER_API_KEY) return await callOpenRouter(env, lang, userText);
    } catch (e) {
      errors.push(String(e?.message || e));
    }
  } else {
    try {
      if (env.OPENROUTER_API_KEY) return await callOpenRouter(env, lang, userText);
    } catch (e) {
      errors.push(String(e?.message || e));
    }
    try {
      if (env.GOOGLE_API_KEY) return await callGemini(env, lang, userText);
    } catch (e) {
      errors.push(String(e?.message || e));
    }
  }

  const diag = String(env.DIAG_TAGS || "off").toLowerCase() === "on" ? `\n\n(diag: ${errors.join(" | ")})` : "";
  if (lang === "ru") return `Сейчас у меня проблемы с AI-провайдерами. Попробуй позже.${diag}`;
  if (lang === "en") return `I have issues reaching AI providers right now. Please try again later.${diag}`;
  return `Зараз є проблеми з AI-провайдерами. Спробуй трохи пізніше.${diag}`;
}

function startText(lang, firstName) {
  if (lang === "ru") return `Привет, ${firstName || "друг"}! Я Senti.\nНапиши вопрос или отправь фото — я опишу его.`;
  if (lang === "en") return `Hi, ${firstName || "friend"}! I'm Senti.\nAsk a question or send a photo — I'll describe it.`;
  return `Привіт, ${firstName || "друже"}! Я Senti.\nНапиши питання або надішли фото — я опишу його.`;
}

function voiceIntroText(lang) {
  if (lang === "ru") return "🎙 Senti Voice: открой Mini App.";
  if (lang === "en") return "🎙 Senti Voice: open the Mini App.";
  return "🎙 Senti Voice: відкрий Mini App.";
}

function parseCommand(text) {
  const first = String(text || "").trim().split(/\s+/)[0];
  if (!first.startsWith("/")) return "";
  return first.split("@")[0].toLowerCase();
}

// ✅ надійно визначає “Voice” навіть якщо emoji/шрифти відрізняються
function isVoiceText(text) {
  const t = String(text || "").toLowerCase();
  const stripped = t.replace(/[^a-z0-9/]+/g, ""); // "🎙 voice" -> "voice"
  return stripped === "voice" || stripped === "/voice";
}

export default async function webhook(req, env) {
  let update;
  try {
    update = await req.json();
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }

  if (env.TG_WEBHOOK_SECRET) {
    const sec = req.headers.get("x-telegram-bot-api-secret-token");
    if (sec !== env.TG_WEBHOOK_SECRET) return json({ ok: false, error: "unauthorized" }, 401);
  }

  const lang = pickLang(update);

  const msg = update?.message || update?.edited_message;
  const cq = update?.callback_query;

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
  const cmd = parseCommand(text);

  const userId = msg?.from?.id;
  const username = msg?.from?.username;
  const isAdmin = TG.ADMIN?.(env, userId, username) || false;

  if (cmd === "/start") {
    await TG.sendMessage(
      chatId,
      startText(lang, msg?.from?.first_name),
      {
        reply_markup: {
          ...TG.mainKeyboard(isAdmin),
          inline_keyboard: [[{ text: "✅ Ping", callback_data: "ping" }]],
        },
      },
      env
    );
    return json({ ok: true });
  }

  if (cmd === "/menu") {
    await TG.sendMessage(
      chatId,
      lang === "ru" ? "Клавиатура восстановлена." : lang === "en" ? "Keyboard restored." : "Клавіатуру відновлено.",
      { reply_markup: TG.mainKeyboard(isAdmin) },
      env
    );
    return json({ ok: true });
  }

  // ✅ /voice АБО натискання кнопки Voice (reply keyboard)
  if (cmd === "/voice" || isVoiceText(text) || text === TG.BTN_VOICE) {
    const appUrl = abs(env, "/app/voice");
    await TG.sendMessage(
      chatId,
      voiceIntroText(lang),
      { reply_markup: { inline_keyboard: [[{ text: "🎙 Senti Voice", web_app: { url: appUrl } }]] } },
      env
    );
    return json({ ok: true });
  }
// ====== ОБРОБКА КНОПОК (щоб НЕ йшли в AI) ======
  if (text === TG.BTN_DRIVE) {
    const uid = String(userId || chatId);
    const u = new URL(abs(env, "/auth/start"));
    u.searchParams.set("u", uid);

    await TG.sendMessage(
      chatId,
      lang === "ru" ? "Google Drive: подключение." : lang === "en" ? "Google Drive: connect." : "Google Drive: підключення.",
      { reply_markup: { inline_keyboard: [[{ text: "🔐 Connect Drive", url: u.toString() }]] } },
      env
    );
    return json({ ok: true });
  }

  if (text === TG.BTN_ADMIN) {
    await TG.sendMessage(
      chatId,
      lang === "ru" ? "Admin панель." : lang === "en" ? "Admin panel." : "Адмін-панель.",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🧠 Brain", url: abs(env, "/admin/brain") }],
            [{ text: "📋 Checklist", url: abs(env, "/admin/checklist") }],
            [{ text: "🎓 Learn", url: abs(env, "/admin/learn/html") }],
            [{ text: "📦 Repo/Archive", url: abs(env, "/admin/repo") }],
          ],
        },
      },
      env
    );
    return json({ ok: true });
  }

  if (text === TG.BTN_CODEX) {
    await TG.sendMessage(
      chatId,
      lang === "ru"
        ? "Codex сейчас у ремонті. Використовуй /voice або звичайний чат."
        : lang === "en"
        ? "Codex is under maintenance. Use /voice or normal chat."
        : "Codex зараз у ремонті. Використовуй /voice або звичайний чат.",
      {},
      env
    );
    return json({ ok: true });
  }

  if (text === TG.BTN_SENTI) {
    await TG.sendMessage(
      chatId,
      lang === "ru" ? "Я тут. Напиши запит або надішли фото." : lang === "en" ? "I’m here. Send a prompt or a photo." : "Я тут. Напиши запит або надішли фото.",
      {},
      env
    );
    return json({ ok: true });
  }

  if (text === TG.BTN_LEARN) {
    await TG.sendMessage(
      chatId,
      isAdmin
        ? (lang === "ru" ? "Learn (admin): открой панель." : lang === "en" ? "Learn (admin): open the panel." : "Learn (admin): відкрий панель.")
        : (lang === "ru" ? "Learn доступен только админу." : lang === "en" ? "Learn is admin-only." : "Learn доступний лише адміну."),
      isAdmin ? { reply_markup: { inline_keyboard: [[{ text: "🎓 Learn panel", url: abs(env, "/admin/learn/html") }]] } } : {},
      env
    );
    return json({ ok: true });
  }

  if (/^(дата|date)$/i.test(text)) {
    await TG.sendMessage(chatId, `📅 ${nowKyiv().split(",")[0]}`, {}, env);
    return json({ ok: true });
  }
  if (/^(час|time|время)$/i.test(text)) {
    await TG.sendMessage(chatId, `🕒 ${nowKyiv()}`, {}, env);
    return json({ ok: true });
  }

  if (msg.photo) {
    try {
      await handlePhoto(env, msg, lang);
      return json({ ok: true });
    } catch (e) {
      const diag = String(env.DIAG_TAGS || "off").toLowerCase() === "on" ? `\n(diag: ${String(e?.message || e)})` : "";
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

  if (msg.document || msg.video || msg.voice || msg.sticker) {
    const m =
      lang === "ru"
        ? "Медиа получено. Пока я обрабатываю только фото."
        : lang === "en"
        ? "Media received. For now I process photos only."
        : "Медіа отримано. Поки що я обробляю лише фото.";
    await TG.sendMessage(chatId, m, {}, env);
    return json({ ok: true });
  }

  if (!text) {
    await TG.sendMessage(chatId, lang === "ru" ? "Напиши текстовый запрос." : lang === "en" ? "Send a text query." : "Напиши текстовий запит.", {}, env);
    return json({ ok: true });
  }

  const reply = await answerWithAI(env, lang, text);
  await TG.sendMessage(chatId, reply, {}, env);

  return json({ ok: true });
}