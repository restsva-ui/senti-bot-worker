// src/lib/tone.js
// Tone control for Senti: auto detection + manual override via /tone.
// Stores state in STATE_KV under key tone:<chatId>:
// { mode: "auto" | "manual", value: "<tone>", last: "<auto-detected>" , ts: <ms> }

const TONE_KEY = (cid) => `tone:${cid}`;

// canonical tones Senti understands in the system prompt
export const CANON_TONES = [
  "friendly",    // теплий дружній
  "casual",      // розмовний, прості речення
  "playful",     // трішки гумору/емодзі
  "concise",     // максимально стисло
  "professional",// ввічливо-діловий
  "formal",      // офіційно
  "empathetic",  // підтримуючий
  "neutral"      // нейтральний
];

// mapping user input → canonical
const MAP = {
  auto: "auto",
  friendly: "friendly",
  casual: "casual",
  playful: "playful",
  fun: "playful",
  concise: "concise",
  short: "concise",
  pro: "professional",
  professional: "professional",
  formal: "formal",
  business: "formal",
  empathetic: "empathetic",
  caring: "empathetic",
  neutral: "neutral",
};

function ensureKV(env) {
  if (!env?.STATE_KV) throw new Error("STATE_KV binding missing");
  return env.STATE_KV;
}

async function load(env, chatId) {
  const kv = ensureKV(env);
  try {
    const raw = await kv.get(TONE_KEY(chatId));
    if (!raw) return { mode: "auto", value: "", last: "", ts: 0 };
    const obj = JSON.parse(raw);
    return {
      mode: obj.mode === "manual" ? "manual" : "auto",
      value: String(obj.value || ""),
      last: String(obj.last || ""),
      ts: Number(obj.ts || 0),
    };
  } catch {
    return { mode: "auto", value: "", last: "", ts: 0 };
  }
}

async function save(env, chatId, state) {
  const kv = ensureKV(env);
  const obj = {
    mode: state.mode || "auto",
    value: String(state.value || ""),
    last: String(state.last || ""),
    ts: Date.now(),
  };
  await kv.put(TONE_KEY(chatId), JSON.stringify(obj), { expirationTtl: 60 * 60 * 24 * 180 }); // 180d
  return obj;
}

// --- public API --------------------------------------------------------------

/** Get current tone state */
export async function getTone(env, chatId) {
  return load(env, chatId);
}

/** Set tone: "auto" to switch back to auto-mode, or any canonical value */
export async function setTone(env, chatId, value) {
  const v = String(value || "").toLowerCase().trim();
  if (v === "auto") return save(env, chatId, { mode: "auto", value: "", last: "", ts: Date.now() });

  const canon = MAP[v] || "";
  if (!canon || !CANON_TONES.includes(canon)) {
    throw new Error(`unknown tone "${value}"`);
  }
  return save(env, chatId, { mode: "manual", value: canon, last: "", ts: Date.now() });
}

/** Lightweight heuristic auto-detection by message content (updates KV when in auto mode). */
export async function detectTone(env, chatId, text) {
  const state = await load(env, chatId);
  if (state.mode !== "auto") return state; // no change in manual

  const s = String(text || "");
  if (!s) return state;

  const lower = s.toLowerCase();
  const len = s.length;

  // very small & direct → concise
  if (len < 25 && /[?.!]$/.test(s)) {
    state.last = "concise";
  }
  // lots of emojis/exclamations → playful
  else if ((s.match(/[!😂😅😎🔥✨💡😍😉🤔]/g) || []).length >= 2) {
    state.last = "playful";
  }
  // clearly polite/official markers → professional/formal
  else if (/\b(будь ласка|прохання|прошу|будь ласка,|з повагою)\b/i.test(lower)
        || /\b(пожалуйста|с уважением)\b/i.test(lower)
        || /\b(mit freundlichen grüßen|bitte)\b/i.test(lower)
        || /\b(please|kind regards)\b/i.test(lower)
        || /\b(merci|s'il vous plaît|cordialement)\b/i.test(lower)) {
    state.last = "professional";
  }
  // very long sentence → professional/neutral
  else if (len > 280) {
    state.last = "professional";
  }
  // default
  else {
    state.last = "friendly";
  }

  await save(env, chatId, state);
  return state;
}

/** Build a short instruction for the system prompt given current state. */
export async function toneHint(env, chatId, lang = "en") {
  const st = await load(env, chatId);
  const effective = st.mode === "manual" ? st.value : (st.last || "friendly");

  // one-liners per tone (English — works well as meta-instruction)
  const map = {
    friendly: "Use a warm, friendly tone. Be supportive and positive.",
    casual: "Use a casual, conversational tone. Short sentences, simple words.",
    playful: "Use a playful, light tone. A tiny bit of humor is OK. Emojis only if natural.",
    concise: "Be concise. Keep answers short and straight to the point.",
    professional: "Use a professional, polite tone. Stay clear and helpful.",
    formal: "Use a formal, respectful tone. Avoid slang.",
    empathetic: "Use an empathetic, caring tone. Acknowledge feelings briefly.",
    neutral: "Use a neutral, matter-of-fact tone without emotional coloring.",
  };

  const line = map[effective] || map.friendly;
  // explicit pin for the model:
  return `[Tone]\nMode: ${st.mode}\nEffective tone: ${effective}\nInstruction: ${line}`;
}

/** Help string with allowed tones */
export function toneHelp() {
  return `Available tones:
- auto (default)
- friendly, casual, playful
- concise
- professional, formal
- empathetic, neutral

Example:
  /tone auto
  /tone friendly
  /tone concise`;
}