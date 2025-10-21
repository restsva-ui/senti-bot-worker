// src/lib/selfRegulate.js
// Саморегуляція: формує й оновлює "правила поведінки" на базі нічних інсайтів/пам'яті.

const RULES_KEY = "brain:rules:current";
const RULES_HISTORY_PREFIX = "brain:rules:hist:";

/** Безпечне читання JSON з KV */
async function kvGetJSONSafe(kv, key, fallback) {
  try {
    const v = await kv.get(key);
    if (!v) return fallback;
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

/** Безпечний запис JSON у KV */
async function kvPutJSONSafe(kv, key, obj, options) {
  try {
    await kv.put(key, JSON.stringify(obj), options);
    return true;
  } catch {
    return false;
  }
}

/** Квантування в діапазоні [min,max] */
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));

/**
 * Прості евристики для тюнінгу правил.
 * insights – довільний об'єкт/массив від nightlyAutoImprove (може бути null).
 */
function computeNewRules(oldRules = {}, insights = null, factor = 0.3) {
  const now = new Date().toISOString();

  // дефолтні правила
  const base = {
    version: 1,
    updated: now,
    // поведінка відповіді
    tone: oldRules.tone || "friendly, concise",
    temperature: Number.isFinite(oldRules.temperature) ? oldRules.temperature : 0.6,
    max_tokens: Number.isFinite(oldRules.max_tokens) ? oldRules.max_tokens : 800,
    // м'які уподобання моделей (необов'язкове)
    model_bias: oldRules.model_bias || {
      prefer: ["gemini:gemini-2.5-flash"],
      fallback: ["cf:@cf/meta/llama-3.1-8b-instruct", "openrouter:deepseek/deepseek-chat"],
    },
  };

  // ── Heuristics ─────────────────────────────────────────────────────────────
  // Якщо останнім часом було багато "довгих" відповідей -> зменшуємо max_tokens трохи.
  // Якщо мало медіа/посилань — підвищуємо temperature для креативності.
  // Якщо є інсайт "hallucination" -> зменшуємо temperature.
  let newTemp = base.temperature;
  let newMax = base.max_tokens;

  const f = clamp(Number(factor) || 0, 0, 1); // сила впливу

  try {
    if (insights && typeof insights === "object") {
      const str = JSON.stringify(insights).toLowerCase();

      if (str.includes("too long") || str.includes("trim")) {
        newMax = clamp(base.max_tokens * (1 - 0.15 * f), 400, 1200);
      }
      if (str.includes("too short")) {
        newMax = clamp(base.max_tokens * (1 + 0.15 * f), 400, 1600);
      }
      if (str.includes("hallucination") || str.includes("incorrect")) {
        newTemp = clamp(base.temperature * (1 - 0.25 * f), 0.2, 0.9);
      } else if (str.includes("boring") || str.includes("dry") || str.includes("needs more ideas")) {
        newTemp = clamp(base.temperature * (1 + 0.2 * f), 0.2, 0.9);
      }
      if (str.includes("gemini good") || str.includes("gemini strong")) {
        // додати легкий пріоритет джеміні на перше місце
        const prefer = Array.from(new Set(["gemini:gemini-2.5-flash", ...(base.model_bias?.prefer || [])]));
        base.model_bias = { ...base.model_bias, prefer };
      }
    }
  } catch {
    // тихо ігноруємо
  }

  return {
    ...base,
    temperature: newTemp,
    max_tokens: newMax,
    updated: now,
  };
}

/**
 * Основна функція: читає поточні правила, обчислює нові, записує у STATE_KV,
 * веде історію та повертає короткий звіт.
 */
export async function runSelfRegulation(env, insights) {
  const kv = env?.STATE_KV;
  if (!kv) return { ok: false, error: "STATE_KV missing" };

  const factor = Number(env.SELF_TUNING_FACTOR ?? 0.3);

  const prev = await kvGetJSONSafe(kv, RULES_KEY, null);
  const next = computeNewRules(prev || undefined, insights, factor);

  // якщо практично без змін — теж оновлюємо updated, але помітимо це у звіті
  const changed =
    !prev ||
    prev.temperature !== next.temperature ||
    prev.max_tokens !== next.max_tokens ||
    JSON.stringify(prev.model_bias || {}) !== JSON.stringify(next.model_bias || {}) ||
    prev.tone !== next.tone;

  // зберегти історію (до 30 записів; TTL 30 днів)
  try {
    const id = Date.now();
    await kvPutJSONSafe(kv, `${RULES_HISTORY_PREFIX}${id}`, next, { expirationTtl: 60 * 60 * 24 * 30 });
    // (опційно) можна видаляти найстаріші через kv.list, але це не критично
  } catch {}

  await kvPutJSONSafe(kv, RULES_KEY, next);

  // чекліст: тільки якщо є CHECKLIST_KV
  try {
    const chk = env.CHECKLIST_KV;
    if (chk) {
      const line =
        `[auto-reg] ${new Date().toISOString()} rules ` +
        (changed ? `updated (temp=${next.temperature.toFixed(2)}, max=${next.max_tokens})`
                 : `refreshed`);
      await chk.put("checklist:append", line, { metadata: { type: "append" } }).catch(() => {});
    }
  } catch {}

  return {
    ok: true,
    changed,
    rules: next,
  };
}