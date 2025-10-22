// src/lib/selfTune.js
// Self-Tune профілі стилю користувача: багатомовні, автопідлаштування кожні 20 реплік.
// Зовнішній інтерфейс:
//   - loadSelfTune(env, chatId, preferredLang?) -> string|null   (готовий блок для system prompt)
//   - autoUpdateSelfTune(env, userId, preferredLang?) -> { updated: boolean, reason?: string }
//
// Залежить від:
//   - STATE_KV  — для зберігання профілів і службових маркерів
//   - dlg:<uid>:log  — масив реплік діалогу (див. dialogMemory.js)
//   - askAnyModel / think — для стислого аналізу стилю (fallback сумісний)

import { askAnyModel } from "./modelRouter.js";
import { think as coreThink } from "./brain.js";

// ─────────────────────────────────────────────────────────────────────────────
// Налаштування
// ─────────────────────────────────────────────────────────────────────────────
const PROFILE_KEY = (chatId, lang) => `selftune:profile:${chatId}:${lang || "any"}`;
const INDEX_KEY   = (chatId)        => `selftune:index:${chatId}`;            // список наявних мов профілю
const LEGACY_KEY  = (chatId)        => `insight:latest:${chatId}`;            // сумісність із попереднім форматом (текст)
const LASTCOUNT_KEY = (chatId, lang) => `selftune:lastCount:${chatId}:${lang || "any"}`;
const LASTRUN_KEY   = (chatId, lang) => `selftune:lastRun:${chatId}:${lang || "any"}`;

const DLG_LOG_KEY = (userId)        => `dlg:${userId}:log`;                    // як у dialogMemory.js

const USER_TURNS_PER_UPDATE = 20;   // кожні 20 користувацьких реплік
const MIN_UPDATE_INTERVAL_MS = 5 * 60 * 1000; // не частіше ніж раз на 5 хв
const MAX_SAMPLES = 40;             // макс. реплік (user) у вибірці для аналізу
const LANG_FALLBACKS = ["uk","ru","en","de","fr"]; // якщо preferredLang немає

// ─────────────────────────────────────────────────────────────────────────────
// Утиліти KV
// ─────────────────────────────────────────────────────────────────────────────
function ensureState(env) {
  if (!env.STATE_KV) throw new Error("STATE_KV binding missing");
  return env.STATE_KV;
}
async function kvGetJSON(kv, key, fallback = null) {
  try {
    const raw = await kv.get(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
  } catch { return fallback; }
}
async function kvPutJSON(kv, key, obj) {
  try { await kv.put(key, JSON.stringify(obj)); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Публічний API: читання профілю
// ─────────────────────────────────────────────────────────────────────────────

/**
 * loadSelfTune: повертає сформований текстовий блок для system prompt.
 * Якщо передано preferredLang — підтягує відповідний профіль; інакше бере перший доступний.
 * Залишається сумісним із попереднім кодом (можна викликати з 2 аргументами).
 */
export async function loadSelfTune(env, chatId, preferredLang) {
  try {
    const kv = ensureState(env);

    // 1) якщо є профіль для preferredLang → беремо його
    if (preferredLang) {
      const prof = await kvGetJSON(kv, PROFILE_KEY(chatId, preferredLang), null);
      if (prof) return formatProfileBlock(prof, preferredLang);
    }

    // 2) інакше шукаємо будь-який профіль із індексу
    const idx = await kvGetJSON(kv, INDEX_KEY(chatId), []);
    for (const lang of [preferredLang, ...LANG_FALLBACKS, ...(idx || [])].filter(Boolean)) {
      const prof = await kvGetJSON(kv, PROFILE_KEY(chatId, lang), null);
      if (prof) return formatProfileBlock(prof, lang);
    }

    // 3) сумісність зі старим ключем (просто текст)
    const legacy = await kv.get(LEGACY_KEY(chatId)).catch(() => null);
    if (legacy) return String(legacy || "").trim();

    return null;
  } catch {
    return null;
  }
}

/** Форматує профіль у компактний блок для system prompt */
function formatProfileBlock(profile, langTag = "any") {
  const tone = (profile?.tone || "").trim();
  const rules = Array.isArray(profile?.rules) ? profile.rules : [];
  const style = profile?.style || {};
  const samples = Array.isArray(profile?.samples) ? profile.samples : [];

  const lines = [];
  lines.push(`[Self-Tune ${langTag}]`);
  if (tone) lines.push(`• Тон користувача: ${tone}.`);
  if (rules.length) {
    lines.push("• Звички/правила спілкування:");
    for (const r of rules.slice(0, 8)) lines.push(`  – ${r}`);
  }
  if (style && (style.formality || style.warmth || style.emoji || style.slang)) {
    const bits = [];
    if (style.formality) bits.push(`формальність: ${style.formality}`);
    if (style.warmth) bits.push(`теплота: ${style.warmth}`);
    if (style.emoji) bits.push(`емодзі: ${style.emoji}`);
    if (style.slang) bits.push(`сленг: ${style.slang}`);
    if (bits.length) lines.push(`• Параметри стилю: ${bits.join(", ")}.`);
  }
  if (samples.length) lines.push(`• Улюблені фрази: ${samples.slice(0,4).join(" • ")}`);
  lines.push("— Дотримуйся цього стилю, коли відповідаєш користувачу.");
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Публічний API: автооновлення профілю (викликати після pushTurn(...,"user",...))
// ─────────────────────────────────────────────────────────────────────────────

export async function autoUpdateSelfTune(env, userId, preferredLang) {
  try {
    const kv = ensureState(env);
    const log = await kvGetJSON(kv, DLG_LOG_KEY(userId), []);
    if (!Array.isArray(log) || !log.length) return { updated: false, reason: "no_log" };

    // Визначаємо активну мову: якщо передали — використовуємо її,
    // інакше приблизно — за останніми репліками (дуже грубо).
    const lang = (preferredLang || guessLangFromLog(log) || "any").toLowerCase();

    const userTurnsAll = log.filter(x => x?.role === "user" && x?.text).map(x => String(x.text));
    const userTurnsCount = userTurnsAll.length;

    const lastCount = Number(await kv.get(LASTCOUNT_KEY(userId, lang))) || 0;
    const lastRun = Number(await kv.get(LASTRUN_KEY(userId, lang))) || 0;

    // Тротл: не частіше ніж раз на 5 хв
    const now = Date.now();
    if (now - lastRun < MIN_UPDATE_INTERVAL_MS) {
      return { updated: false, reason: "throttled" };
    }

    // Поріг: кожні 20 користувацьких реплік
    if (userTurnsCount - lastCount < USER_TURNS_PER_UPDATE) {
      return { updated: false, reason: "not_enough_new_turns" };
    }

    // Готуємо вибірку останніх user-повідомлень
    const sample = userTurnsAll.slice(-MAX_SAMPLES);
    const profile = await synthesizeProfile(env, sample, lang);

    // Зберігаємо профіль
    await kvPutJSON(kv, PROFILE_KEY(userId, lang), profile);

    // Оновлюємо індекс мов для цього користувача
    const idx = await kvGetJSON(kv, INDEX_KEY(userId), []);
    if (!idx.includes(lang)) {
      idx.push(lang);
      await kvPutJSON(kv, INDEX_KEY(userId), idx.slice(0, 12)); // невелика «кепка» на індекс
    }

    // Сумісність: записати текстову версію в legacy-ключ
    try {
      await kv.put(LEGACY_KEY(userId), formatProfileBlock(profile, lang));
    } catch {}

    // Службові лічильники
    try {
      await kv.put(LASTCOUNT_KEY(userId, lang), String(userTurnsCount));
      await kv.put(LASTRUN_KEY(userId, lang), String(now));
    } catch {}

    return { updated: true };
  } catch (e) {
    return { updated: false, reason: String(e?.message || e) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Аналіз стилю через LLM
// ─────────────────────────────────────────────────────────────────────────────

async function synthesizeProfile(env, samples, lang = "any") {
  const joined = samples
    .map(s => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(-MAX_SAMPLES)
    .join("\n• ");

  const sys = `You are a concise sociolinguistic analyzer.
Given several recent user utterances, infer their communication style in ${lang}.
Be precise, terse, and avoid generic fluff. Return STRICT JSON.`;

  const prompt = `Recent user utterances (bullet list):
• ${joined}

Return STRICT JSON with the following shape and short, concrete values:

{
  "tone": "<5–10 words in ${lang} describing tone (e.g. теплий, трохи іронічний, неформальний)>",
  "rules": [
    "<habit 1 in ${lang}, concrete and short>",
    "<habit 2>",
    "<habit 3>"
  ],
  "style": {
    "formality": "<low|medium|high>",
    "warmth": "<low|medium|high>",
    "emoji": "<rare|sometimes|often>",
    "slang": "<none|mild|rich>"
  },
  "samples": [
    "<2–4 short favorite phrases the user tends to use, in ${lang}>"
  ]
}

Notes:
- Keep total JSON under ~700 chars.
- Do NOT include explanations outside JSON. Only JSON.`;

  let raw;
  try {
    const order = String(env.MODEL_ORDER || "").trim();
    raw = order
      ? await askAnyModel(env, order, prompt, { systemHint: sys, temperature: 0.2, max_tokens: 300 })
      : await coreThink(env, prompt, sys);
  } catch {
    // fallback на найпростіший профіль, якщо LLM недоступний
    return {
      tone: "дружній, неформальний",
      rules: ["короткі відповіді", "по суті", "без води"],
      style: { formality: "low", warmth: "high", emoji: "sometimes", slang: "mild" },
      samples: []
    };
  }

  const cleaned = sanitizeToJson(raw);
  let obj = safeParse(cleaned, null);
  if (!obj || typeof obj !== "object") {
    // ще одна спроба з fallback-промптом
    try {
      const fix = `The previous output was not strict JSON. Respond again with ONLY the JSON as specified.`;
      const order = String(env.MODEL_ORDER || "").trim();
      const again = order
        ? await askAnyModel(env, order, fix, { systemHint: sys, temperature: 0.1, max_tokens: 280 })
        : await coreThink(env, fix, sys);
      obj = safeParse(sanitizeToJson(again), null);
    } catch {}
  }

  // Страхувальний мінімум
  if (!obj || typeof obj !== "object") {
    return {
      tone: "дружній, неформальний",
      rules: ["короткі відповіді", "по суті", "без води"],
      style: { formality: "low", warmth: "high", emoji: "sometimes", slang: "mild" },
      samples: []
    };
  }

  // Обмеження довжин
  const tone = String(obj.tone || "").trim().slice(0, 120);
  const rules = (Array.isArray(obj.rules) ? obj.rules : []).map(s => String(s || "").trim()).filter(Boolean).slice(0, 8);
  const style = obj.style && typeof obj.style === "object"
    ? {
        formality: oneOf(obj.style.formality, ["low","medium","high"], "medium"),
        warmth:    oneOf(obj.style.warmth,    ["low","medium","high"], "high"),
        emoji:     oneOf(obj.style.emoji,     ["rare","sometimes","often"], "sometimes"),
        slang:     oneOf(obj.style.slang,     ["none","mild","rich"], "mild"),
      }
    : { formality: "medium", warmth: "high", emoji: "sometimes", slang: "mild" };
  const samplesOut = (Array.isArray(obj.samples) ? obj.samples : [])
    .map(s => String(s || "").trim())
    .filter(Boolean)
    .slice(0, 4);

  return { tone, rules, style, samples: samplesOut };
}

// ─────────────────────────────────────────────────────────────────────────────
// Допоміжні
// ─────────────────────────────────────────────────────────────────────────────

function guessLangFromLog(log = []) {
  // Дуже проста евристика: шукаємо маркери кирилиці/латиниці.
  // Реальна детекція є у i18n.detectFromText, але тут не імпортуємо, щоб уникнути циклів.
  // Якщо потрібно — можна передати preferredLang із webhook.
  const lastUser = [...log].reverse().find(x => x?.role === "user" && x?.text);
  if (!lastUser) return null;
  const s = String(lastUser.text || "");
  // Примітивні евристики
  if (/[а-яіїєґ]/i.test(s)) return "uk";
  if (/[а-яё]/i.test(s)) return "ru";
  if (/\bthe\b|\band\b|\bto\b/i.test(s)) return "en";
  if (/\bund\b|\bich\b|\bdu\b/i.test(s)) return "de";
  if (/\bet\b|\bje\b|\btu\b/i.test(s)) return "fr";
  return null;
}

function sanitizeToJson(s) {
  let x = String(s || "");
  x = x.replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = x.indexOf("{");
  const b = x.lastIndexOf("}");
  if (a !== -1 && b !== -1 && b > a) x = x.slice(a, b + 1);
  return x;
}
function safeParse(s, fallback = null) {
  try { return JSON.parse(s); } catch { return fallback; }
}
function oneOf(val, allowed, def) {
  const v = String(val || "").toLowerCase();
  return allowed.includes(v) ? v : def;
}