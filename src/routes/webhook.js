// src/routes/webhook.js
import { TG } from "../lib/tg.js";
import { json } from "../utils/http.js";

function nowKyiv() {
  // Europe/Kyiv без зовнішніх залежностей
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
        // не критично, але корисно
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
  // Пріоритет як у твоєму wrangler: Gemini → OpenRouter
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

  // Фолбек без падіння
  const diag = String(env.DIAG_TAGS || "off").toLowerCase() === "on" ? `\n\n(diag: ${errors.join(" | ")})` : "";
  if (lang === "ru") return `Сейчас у меня проблемы с AI-провайдерами. Попробуй позже.${diag}`;
  if (lang === "en") return `I have issues reaching AI providers right now. Please try again later.${diag}`;
  return `Зараз є проблеми з AI-провайдерами. Спробуй трохи пізніше.${diag}`;
}

function startText(lang, firstName) {
  if (lang === "ru") return `Привет, ${firstName || "друг"}! Я Senti.\nНапиши вопрос или отправь фото (восстановление vision — в процессе).`;
  if (lang === "en") return `Hi, ${firstName || "friend"}! I'm Senti.\nAsk a question or send a photo (vision restore is in progress).`;
  return `Привіт, ${firstName || "друже"}! Я Senti.\nНапиши питання або надішли фото (відновлення vision — в процесі).`;
}

export default async function webhook(req, env) {
  let update;
  try {
    update = await req.json();
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }

  // Додаткова безпека (у тебе ще є перевірка в index.js — дубль безпечний)
  if (env.TG_WEBHOOK_SECRET) {
    const sec = req.headers.get("x-telegram-bot-api-secret-token");
    if (sec !== env.TG_WEBHOOK_SECRET) return json({ ok: false, error: "unauthorized" }, 401);
  }

  const lang = pickLang(update);

  const msg = update?.message || update?.edited_message;
  const cq = update?.callback_query;

  // Callback (кнопки)
  if (cq?.id) {
    const chatId = cq?.message?.chat?.id;
    const data = String(cq?.data || "");

    // якщо є метод у твоєму TG — добре; якщо нема — тихо ігноруємо
    try {
      await TG.answerCallbackQuery?.(cq.id, { text: "OK" }, env);
    } catch {}

    if (chatId) {
      if (data === "ping") {
        await TG.sendMessage(chatId, `✅ OK\n${nowKyiv()}`, {}, env);
        return json({ ok: true });
      }
      // універсальний фолбек
      await TG.sendMessage(chatId, `🔘 ${data}`, {}, env);
    }
    return json({ ok: true });
  }

  // Немає повідомлення — не падаємо
  if (!msg?.chat?.id) return json({ ok: true, note: "no message" });

  const chatId = msg.chat.id;
  const text = String(msg.text || "").trim();

  // /start
  if (text === "/start") {
    await TG.sendMessage(
      chatId,
      startText(lang, msg?.from?.first_name),
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Ping", callback_data: "ping" }],
          ],
        },
      },
      env
    );
    return json({ ok: true });
  }

  // дата/час (без залежності від apis/time.js)
  if (/^(дата|date)$/i.test(text)) {
    await TG.sendMessage(chatId, `📅 ${nowKyiv().split(",")[0]}`, {}, env);
    return json({ ok: true });
  }
  if (/^(час|time|время)$/i.test(text)) {
    await TG.sendMessage(chatId, `🕒 ${nowKyiv()}`, {}, env);
    return json({ ok: true });
  }

  // Фото/медіа: зараз не валимо воркер, відповідаємо стабільно
  if (msg.photo || msg.document || msg.video || msg.voice || msg.sticker) {
    const m =
      lang === "ru"
        ? "Медиа получено. Vision сейчас восстанавливаю — скоро снова будет описание фото."
        : lang === "en"
        ? "Media received. I'm restoring vision support—photo descriptions will be back soon."
        : "Медіа отримано. Відновлюю vision — скоро знову буде опис фото.";
    await TG.sendMessage(chatId, m, {}, env);
    return json({ ok: true });
  }

  // Порожній текст
  if (!text) {
    await TG.sendMessage(chatId, lang === "ru" ? "Напиши текстовый запрос." : lang === "en" ? "Send a text query." : "Напиши текстовий запит.", {}, env);
    return json({ ok: true });
  }

  // Основна відповідь через AI напряму (Gemini/OpenRouter)
  const reply = await answerWithAI(env, lang, text);
  await TG.sendMessage(chatId, reply, {}, env);

  return json({ ok: true });
}