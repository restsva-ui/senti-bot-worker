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
    /я\s+(є|—|-)?\s*(штучн|модель|мова)/i.test(out) ||
    /я\s+(являюсь|есть)\s+(ии|искусственн|языков)/i.test(out) ||
    /ich bin (ein|eine) (ki|sprachmodell)/i.test(out) ||
    /je suis (une|un) (ia|mod[èe]le de langue)/i.test(out)
  );
}
function looksLikeModelDump(s = "") {
  const x = (s || "").toLowerCase();
  return /here(?:'|)s a breakdown|model (aliases|mappings|configurations)/i.test(x) ||
         /gemini-?2\.5|openrouter|deepseek|llama/i.test(x);
}
function looksLikeEmojiStart(s = "") {
  try { return /^[\u2190-\u2BFF\u2600-\u27BF\u{1F000}-\u{1FAFF}]/u.test(String(s)); }
  catch { return false; }
}
function guessEmoji(text = "") {
  const tt = (text || "").toLowerCase();
  if (tt.includes("колес") || tt.includes("wheel")) return "🛞";
  if (tt.includes("дзеркал") || tt.includes("зеркал") || tt.includes("mirror")) return "🪞";
  if (tt.includes("машин") || tt.includes("авто") || tt.includes("car")) return "🚗";
  if (tt.includes("вода") || tt.includes("рідина") || tt.includes("water")) return "💧";
  if (tt.includes("світл") || tt.includes("light") || tt.includes("солнц")) return "☀️";
  if (tt.includes("електр") || tt.includes("струм") || tt.includes("current")) return "⚡";
  return "💡";
}
function limitMsg(s, max = 220) {
  if (!s) return s;
  return s.length <= max ? s : s.slice(0, max - 1);
}

/** ── Основна функція відповіді ───────────────────────────────────────────── */
export async function aiRespond(env, { text, lang, name, systemHint, expand }) {
  const modelOrder = String(env.MODEL_ORDER || "").trim();

  const control = expand
    ? `You are Senti — a thoughtful, emotionally intelligent assistant. Never say you're an AI, model, or a product of any company. Write ONLY in ${lang}; sound natural and human-like. Be warm and helpful. Split long ideas into short Telegram-friendly messages.`
    : `You are Senti — an independent, human-like assistant. Never mention being AI/GPT or created by anyone. Write ONLY in ${lang}. Keep it short and helpful (1–3 sentences). Answer directly without restating the question.`;

  const prompt = `Add one relevant emoji at the start if natural.
User (${name}) says: ${text}
${control}`;

  // 1) перша спроба (model router або think)
  let out = modelOrder
    ? await askAnyModel(env, modelOrder, prompt, { systemHint })
    : await think(env, prompt, { systemHint });

  out = stripProviderSignature((out || "").trim());

  // 2) якщо почав лити технічний дамп про моделі — страхуємося
  if (looksLikeModelDump(out)) {
    const retry = modelOrder
      ? await askAnyModel(env, modelOrder, prompt, { systemHint })
      : await think(env, prompt, { systemHint });
    out = stripProviderSignature((retry || out || "").trim());
  }

  // 3) анти-розкриття «я AI»
  if (revealsAiSelf(out)) {
    const fix = `Rewrite the previous answer as Senti. Do NOT mention being an AI/model or any company. Keep it in ${lang}, concise and natural.`;
    const cleaned = modelOrder
      ? await askAnyModel(env, modelOrder, fix, { systemHint })
      : await think(env, fix, { systemHint });
    out = stripProviderSignature((cleaned || out || "").trim());
  }

  // 4) авто-емодзі + лаконічність
  if (!looksLikeEmojiStart(out)) {
    out = `${guessEmoji(text)} ${out}`;
  }

  // 5) контроль мови: жорстко переписати, якщо випадково не тією мовою
  const detected = detectFromText(out);
  if (detected && lang && detected !== lang) {
    const hardPrompt = `STRICT LANGUAGE MODE: Respond ONLY in ${lang}. If the previous answer used another language, rewrite it now in ${lang}. Keep it concise.`;
    const fixed = modelOrder
      ? await askAnyModel(env, modelOrder, hardPrompt, { systemHint })
      : await think(env, hardPrompt, { systemHint });
    const clean = stripProviderSignature((fixed || "").trim());
    out = looksLikeEmojiStart(clean) ? clean : `${guessEmoji(text)} ${clean}`;
  }

  const short = expand ? out : limitMsg(out, 220);
  return { short, full: out };
}