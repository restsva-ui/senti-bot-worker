// src/lib/dialogMemory.js
// Простий KV-бекенд короткострокової пам’яті діалогу.
// Зберігає останні N реплік і віддає їх у компактному форматі
// для system prompt, щоб модель "пам’ятала" контекст.
//
// API:
//   await pushTurn(env, userId, role, text)
//   await getRecentTurns(env, userId, limit?)
//   await buildDialogHint(env, userId, opts?)

const TURN_LIMIT_DEFAULT = 14;   // скільки реплік тримати у KV (user+assistant разом)
const HINT_TURNS_DEFAULT = 8;    // скільки з останніх реплік підкладати у підказку

function kv(env) {
  return env.STATE_KV || env.CHECKLIST_KV || env.ENERGY_LOG_KV || env.LEARN_QUEUE_KV;
}

function keyLog(userId) {
  return `dlg:${userId}:log`;
}

function toEntry(role, text) {
  return {
    role: role === "assistant" ? "assistant" : "user",
    text: String(text || "").slice(0, 8000), // хард-обмеження від дурних дампів
    ts: Date.now()
  };
}

/**
 * Додати чергову репліку у круговий буфер.
 */
export async function pushTurn(env, userIdRaw, role, text, limit = TURN_LIMIT_DEFAULT) {
  const store = kv(env);
  if (!store) return { ok: false, error: "kv_not_bound" };

  const userId = String(userIdRaw || env.TELEGRAM_ADMIN_ID || "0");
  let arr = [];

  try {
    const raw = await store.get(keyLog(userId), "json");
    if (Array.isArray(raw)) arr = raw;
  } catch {}

  // додати і підрізати
  arr.push(toEntry(role, text));
  if (arr.length > Math.max(4, Number(limit || TURN_LIMIT_DEFAULT))) {
    arr = arr.slice(-Math.max(4, Number(limit || TURN_LIMIT_DEFAULT)));
  }

  try {
    await store.put(keyLog(userId), JSON.stringify(arr));
  } catch {}

  return { ok: true, size: arr.length };
}

/**
 * Отримати останні N реплік у хронології (старі → нові).
 */
export async function getRecentTurns(env, userIdRaw, limit = HINT_TURNS_DEFAULT) {
  const store = kv(env);
  if (!store) return [];

  const userId = String(userIdRaw || env.TELEGRAM_ADMIN_ID || "0");
  try {
    const raw = await store.get(keyLog(userId), "json");
    if (!Array.isArray(raw) || !raw.length) return [];
    const n = Math.max(2, Number(limit || HINT_TURNS_DEFAULT));
    return raw.slice(-n);
  } catch {
    return [];
  }
}

/**
 * Зібрати блок для system prompt:
 * - останні репліки у форматі «[Dialog memory]»
 * - без зайвих деталей, лаконічно
 */
export async function buildDialogHint(env, userIdRaw, opts = {}) {
  const maxTurns = Math.max(2, Number(opts.maxTurns || HINT_TURNS_DEFAULT));
  const turns = await getRecentTurns(env, userIdRaw, maxTurns);

  if (!turns.length) return ""; // нічого не підкладати — модель не вигадуватиме «я не пам’ятаю», бо тексту немає

  const lines = [];
  lines.push("[Dialog memory — recent turns]");
  for (const t of turns) {
    const role = t.role === "assistant" ? "assistant" : "user";
    // коротко: 300 символів на репліку, щоб не роздувати prompt
    const s = String(t.text || "").replace(/\s+/g, " ").trim().slice(0, 300);
    // маркуємо ролі, щоб модель розуміла хто говорив
    lines.push(`${role}: ${s}`);
  }
  lines.push("— End of dialog memory. Keep answers consistent with it.");

  return lines.join("\n");
}