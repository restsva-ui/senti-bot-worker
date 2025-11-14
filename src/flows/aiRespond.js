// src/flows/aiRespond.js

import { think } from "../lib/brain.js";
import { askAnyModel } from "../lib/modelRouter.js";
import { detectFromText } from "../lib/i18n.js";

/** ── Сервісні утиліти (локальні для модуля) ─────────────────────────────── */
function stripProviderSignature(s = "") {
  return String(s).replace(/^[ \t]*(?:—|--)?\s*via\s+[^\n]*\n?/gim, "").trim();
}
function revealsAiSelf(out = "") {
  const s = (out || "").toLowerCase();
  return (
    /(^|\b)as an? (ai|language model)\b/.test(s) ||
    /\bi am (an|a)? (ai|language model|large language model)\b/.test(s) ||
    /\bdeveloped by (google|openai|meta|anthropic)\b/.test(s) ||
    /\bi (cannot|can't) (access|browse)\b/.test(s)
  );
}
function limitMsg(s = "", max = 4096) {
  s = String(s);
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}
function looksLikeEmojiStart(s = "") {
  return /^[\u231A-\uD83E\uDDFF]/.test(s.trim());
}
function guessEmoji(text = "") {
  const low = text.toLowerCase();
  if (low.includes("фото") || low.includes("картин")) return "🖼";
  if (low.includes("код") || low.includes("js") || low.includes("script"))
    return "💻";
  if (low.includes("помилк") || low.includes("error")) return "⚠️";
  return "🤖";
}
/**
 * Головна функція відповіді AI
 * @param {string} text - вхідний запит користувача
 * @param {object} opts - { env, ctx, userId, chatId, mediaUrl, lang, modelOrder, systemHint, expand }
 */
export async function aiRespond(
  text,
  { env, ctx, userId, chatId, mediaUrl = null, lang = "uk", modelOrder = null, systemHint = null, expand = false } = {}
) {
  // 1) базовий системний хінт, щоб не відписувався "як AI"
  const baseSystem =
    systemHint ||
    "Ти Senti — телеграм-помічник. Пиши коротко, по суті, українською. Не розповідай, що ти AI або модель. Якщо просять код — дай код. Якщо текст — дай текст. Якщо не впевнений — скажи, що не впевнений.";

  // 2) якщо присутній mediaUrl — додамо до запиту
  let userPrompt = text;
  if (mediaUrl) {
    userPrompt =
      text +
      `\n\n(Користувач надіслав файл/зображення: ${mediaUrl}. Спочатку коротко опиши, що це, потім виконай запит.)`;
  }

  // 3) вибір моделі: або заданий порядок, або дефолт через think()
  let out = "";
  if (modelOrder && Array.isArray(modelOrder) && modelOrder.length > 0) {
    out = await askAnyModel(env, modelOrder, userPrompt, {
      systemHint: baseSystem,
    });
  } else {
    out = await think(env, userPrompt, { systemHint: baseSystem });
  }

  out = (out || "").trim();
  out = stripProviderSignature(out);

  // 4) прибрати саморозкриття AI
  if (revealsAiSelf(out)) {
    out = out.replace(/as an? (ai|language model)[^.,]*/gi, "").trim();
  }
// 5) контроль мови: жорстко переписати, якщо випадково не тією мовою
  const detected = detectFromText(out);
  if (detected && lang && detected !== lang) {
    const hardPrompt = `STRICT LANGUAGE MODE: Respond ONLY in ${lang}. User asked: "${text}". You answered in another language, rewrite it now in ${lang}. Keep it concise.`;
    const fixed = modelOrder
      ? await askAnyModel(env, modelOrder, hardPrompt, { systemHint: baseSystem })
      : await think(env, hardPrompt, { systemHint: baseSystem });
    const clean = stripProviderSignature((fixed || "").trim());
    out = looksLikeEmojiStart(clean) ? clean : `${guessEmoji(text)} ${clean}`;
  }

  const short = expand ? out : limitMsg(out, 220);
  return { short, full: out };
}