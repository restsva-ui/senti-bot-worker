// /start → яскраве перше вітання
if (text && /^\/start\b/i.test(text.trim())) {
  const greet = buildGreet({ name: userName, lang: replyLang, genderTone, firstTime: true });
  await tgSendMessage(env, chatId, greet);
  return;
}
// звичайне привітання
if (text && /\b(привіт|привет|hello|hi|hola|salut|hallo)\b/i.test(text)) {
  const greet = buildGreet({ name: userName, lang: replyLang, genderTone, firstTime: false });
  await tgSendMessage(env, chatId, greet);
  return;
}
// index.js — Senti v4.1 (Cloudflare Workers, модульний)
// Bindings у wrangler.toml:
// [[kv_namespaces]] binding = "AIMAGIC_SESS" ; id="2cbb2a8da8d547358d577524cf3eb70a"
// [ai] binding = "AI"
// [vars] WEBHOOK_SECRET="senti1984", DEFAULT_FIAT="UAH"
// TELEGRAM_TOKEN — у Secrets

import { handleFX } from "./src/fx.js";
import { handleCrypto } from "./src/crypto.js";
import { handleGifts } from "./src/gifts.js";
import { handleCalendar } from "./src/calendar.js";
import { handleMedia } from "./src/media.js";
import {
  detectLang,
  ensurePersonaTone,
  getChatLang,
  setChatLang,
  extractGenderTone,
  parseNumbersAndCurrency,
  buildGreet, // використовуємо для /start та звичайного привітання
} from "./src/lang.js";

// ===== Telegram helpers =====
async function tgSendChatAction(env, chat_id, action = "typing") {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendChatAction`;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id, action }),
  }).catch(() => {});
}

async function tgSendMessage(env, chat_id, text, opts = {}) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`;
  const body = { chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...opts };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok ? res.json() : null;
}

async function tgReplyMediaHint(env, chat_id, langCode) {
  const hint =
    langCode === "uk"
      ? "Надішли фото без підпису — можу описати, покращити, стилізувати або прибрати/замінити фон."
      : langCode === "ru"
      ? "Пришли фото без подписи — опишу, улучшу, стилизую или уберу/заменю фон."
      : langCode === "de"
      ? "Sende ein Foto ohne Text – ich kann beschreiben, verbessern, stylen oder den Hintergrund entfernen/ersetzen."
      : langCode === "fr"
      ? "Envoie une photo sans texte – je peux décrire, améliorer, styliser ou remplacer le fond."
      : "Send a photo without caption — I can describe, enhance, stylize, or remove/replace the background.";
  await tgSendMessage(env, chat_id, hint);
}

// ===== KV helpers =====
const kvKey = (chatId, key) => `chat:${chatId}:${key}`;

async function getDefaultFiat(env, chatId) {
  const v = await env.AIMAGIC_SESS.get(kvKey(chatId, "default_fiat"));
  if (v) return v;
  return env.DEFAULT_FIAT || "UAH";
}

async function setDefaultFiat(env, chatId, code) {
  await env.AIMAGIC_SESS.put(kvKey(chatId, "default_fiat"), code, { expirationTtl: 90 * 24 * 3600 });
}

// ===== Command handlers =====
const CMD_SET_FIAT = new Set(["/uah", "/usd", "/eur"]);

async function handleSetFiat(env, chatId, cmd) {
  const code = cmd.replace("/", "").toUpperCase();
  const map = { UAH: "UAH", USD: "USD", EUR: "EUR" };
  const iso = map[code] || code;
  await setDefaultFiat(env, chatId, iso);
  const reply =
    iso === "UAH"
      ? "Базову валюту встановлено: UAH (гривня)."
      : iso === "USD"
      ? "Базову валюту встановлено: USD (долар)."
      : iso === "EUR"
      ? "Базову валюту встановлено: EUR (євро)."
      : `Базову валюту встановлено: ${iso}.`;
  await tgSendMessage(env, chatId, reply);
}

// ===== Main dispatcher =====
async function dispatchMessage(env, update) {
  const msg = update.message || update.edited_message;
  if (!msg) return;

  const chatId = msg.chat?.id;
  if (!chatId) return;

  tgSendChatAction(env, chatId, "typing");

  const userName =
    msg.from?.first_name ||
    msg.from?.username ||
    (msg.from?.language_code ? "друже" : "friend");

  let text = msg.text || msg.caption || "";
  const isPhoto = Boolean(msg.photo?.length);
  const isSticker = Boolean(msg.sticker);
  const isAnimation = Boolean(msg.animation);
  const hasMedia = isPhoto || isSticker || isAnimation;

  // Мова
  const lastLang = (await getChatLang(env.AIMAGIC_SESS, chatId)) || "uk";
  const detectedLang = text ? await detectLang(text) : lastLang;
  const replyLang = detectedLang || lastLang;
  if (replyLang !== lastLang) {
    await setChatLang(env.AIMAGIC_SESS, chatId, replyLang);
  }

  const genderTone = extractGenderTone(text || "");

  // Команди /uah /usd /eur
  if (text && CMD_SET_FIAT.has(text.trim().toLowerCase())) {
    await handleSetFiat(env, chatId, text.trim().toLowerCase());
    return;
  }

  // ===== Greeting logic =====
  // Перше знайомство: /start (в т.ч. з параметром /start xyz)
  if (text && /^\/start\b/i.test(text.trim())) {
    const greet = buildGreet({ name: userName, lang: replyLang, genderTone, firstTime: true });
    await tgSendMessage(env, chatId, greet);
    return;
  }
  // Звичайне привітання
  if (text && /\b(привіт|привет|hello|hi|hola|salut|hallo)\b/i.test(text)) {
    const greet = buildGreet({ name: userName, lang: replyLang, genderTone, firstTime: false });
    await tgSendMessage(env, chatId, greet);
    return;
  }

  // Розбір чисел/валют/дат
  const parsed = parseNumbersAndCurrency(text);

  // 1) Media без тексту → підказка
  if (hasMedia && !text) {
    await handleMedia(env, { chatId, replyLang, mode: "hint" });
    await tgReplyMediaHint(env, chatId, replyLang);
    return;
  }

  // 2) FX (fiat) — без "(ER)" у відповіді; "(НБУ/NBU)" лише для NBU
  if (text && /\b(курс|nbu|нбу|usd|eur|uah|\$|€|грн|долар|євро|гривн)/i.test(text)) {
    const defaultFiat = await getDefaultFiat(env, chatId);
    const res = await handleFX(env, { text, parsed, defaultFiat, replyLang });
    if (res?.text) {
      await tgSendMessage(env, chatId, res.text);
      return;
    }
  }

  // 3) Crypto
  if (text && /\b(btc|eth|usdt|usdc|bnb|sol|ton|крипто|crypto)\b/i.test(text)) {
    const defaultFiat = await getDefaultFiat(env, chatId);
    const res = await handleCrypto(env, { text, parsed, defaultFiat, replyLang });
    if (res?.text) {
      await tgSendMessage(env, chatId, res.text);
      return;
    }
  }

  // 4) Календар/свята
  if (text && /(сьогодні|вчора|завтра|дата|який сьогодні день|свята|а не офіційного)/i.test(text)) {
    const res = await handleCalendar(env, { text, replyLang });
    if (res?.text) {
      await tgSendMessage(env, chatId, res.text);
      return;
    }
  }

  // 5) Gifts
  if (text && /(подар|ідеї|що подарувати|gift)/i.test(text)) {
    const defaultFiat = await getDefaultFiat(env, chatId);
    const res = await handleGifts(env, { text, parsed, defaultFiat, replyLang });
    if (res?.text) {
      await tgSendMessage(env, chatId, res.text);
      return;
    }
  }

  // 6) Media-компліменти/стікери/гіф (без дублю привітання)
  if (text && /(емодзі|emoji|стікер|стикер|gif|гіф|настрій|весело|сумно|люблю|клас)/i.test(text)) {
    const res = await handleMedia(env, { chatId, replyLang, mode: "friendly" });
    if (res?.text) await tgSendMessage(env, chatId, res.text);
    return;
  }

  // 7) Fallback → коротко, персонально
  const persona = ensurePersonaTone({ name: userName, lang: replyLang, genderTone });
  const prompt =
    replyLang === "uk"
      ? `Ти — Senti, доброзичливий асистент. Відповідай коротко, чітко, без вигадок. Якщо намір неясний — чемно уточни.
Користувач (${persona}): ${text || "(без тексту)"}`
      : replyLang === "ru"
      ? `Ты — Senti, дружелюбный ассистент. Отвечай кратко и чётко, без выдумок. Если намерение неясно — вежливо уточни.
Пользователь (${persona}): ${text || "(без текста)"}`
      : replyLang === "de"
      ? `Du bist Senti, ein freundlicher Assistent. Antworte kurz und präzise. Wenn unklar — höflich nachfragen.
Nutzer (${persona}): ${text || "(kein Text)"}`
      : replyLang === "fr"
      ? `Tu es Senti, un assistant amical. Réponds brièvement et clairement. Si c’est flou — demande poliment.
Utilisateur (${persona}) : ${text || "(sans texte)"}`
      : `You are Senti, a friendly assistant. Reply briefly and clearly. If intent is unclear — politely ask.
User (${persona}): ${text || "(no text)"}`;

  try {
    const aiRes = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      prompt,
      max_tokens: 256,
      temperature: 0.4,
    });
    const answer = (aiRes?.response || "").trim() || (replyLang === "uk" ? "Можеш уточнити, будь ласка?" : "Could you clarify?");
    await tgSendMessage(env, chatId, answer);
  } catch (e) {
    const fail =
      replyLang === "uk"
        ? "Тимчасова помилка відповіді. Спробуй ще раз."
        : replyLang === "ru"
        ? "Временная ошибка ответа. Попробуй ещё раз."
        : replyLang === "de"
        ? "Vorübergehender Fehler. Bitte versuche es erneut."
        : replyLang === "fr"
        ? "Erreur temporaire. Réessaie."
        : "Temporary error. Please try again.";
    await tgSendMessage(env, chatId, fail);
  }
}

// ===== Worker entrypoint =====
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // Healthcheck
      if (request.method === "GET" && url.pathname === "/") {
        return new Response("Senti v4.1 up", { status: 200 });
      }

      // Webhook endpoint: /<WEBHOOK_SECRET> == /senti1984
      if (url.pathname === `/${env.WEBHOOK_SECRET}`) {
        if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
        const update = await request.json().catch(() => null);
        if (!update) return new Response("Bad Request", { status: 400 });

        ctx.waitUntil(dispatchMessage(env, update));
        return new Response("OK", { status: 200 });
      }

      return new Response("Not Found", { status: 404 });
    } catch (err) {
      return new Response("Internal Error", { status: 500 });
    }
  },
};