// src/lib/selfTune.js
// Auto-Adapt / Self-Tune: читає останній інсайт користувача зі STATE_KV
// і підмішує правила у system-prompt + робить м'який пост-процес відповіді.

const DEFAULT_FACTOR = 0.3; // якщо env.SELF_TUNING_FACTOR відсутній

// ---- helpers ----
function clamp01(x) { return Math.max(0, Math.min(1, Number.isFinite(+x) ? +x : 0)); }
function asArray(x)  { return Array.isArray(x) ? x : (x ? [x] : []); }

export async function loadLatestInsight(env, chatId) {
  if (!env?.STATE_KV || !chatId) return null;
  const raw = await env.STATE_KV.get(`insight:latest:${chatId}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Формуємо короткий system-додаток із правил
export function buildAdaptiveSystem(insight, env) {
  if (!insight?.analysis) return null;

  const factor = clamp01(env?.SELF_TUNING_FACTOR ?? DEFAULT_FACTOR);
  const rules  = asArray(insight.analysis.rules)
    .map(s => String(s || "").trim())
    .filter(Boolean)
    .slice(0, 5);

  // Фоли: якщо правил нема — підкажемо з pain_points
  if (rules.length === 0) {
    const pains = asArray(insight.analysis.pain_points).join(" ").toLowerCase();
    if (pains.includes("довг")) rules.push("відповідати коротко і по суті");
    if (pains.includes("неструкт")) rules.push("робити марковані списки для кроків");
  }

  if (rules.length === 0) return null;

  // Вага (factor) впливає на формулювання, але без агресивних заборон
  const strength = factor < 0.34 ? "мʼяко" : factor < 0.67 ? "помірно" : "виразно";

  const sys = [
    "Адаптація під користувача (Self-Tune):",
    `Застосовуй ${strength}, але не на шкоду точності.`,
    "Правила на цю сесію (перелічені важливі → менш):",
    ...rules.map((r, i) => `${i + 1}. ${r}`),
    "Лаконічність важливіша за багатослівність.",
  ].join("\n");

  return sys;
}

// Легкий пост-процес відповіді відповідно до правил
export function postProcessDraft(draft, insight, env) {
  if (!draft || !insight?.analysis) return draft;

  const factor = clamp01(env?.SELF_TUNING_FACTOR ?? DEFAULT_FACTOR);
  const text = String(draft).trim();
  const rules = asArray(insight.analysis.rules).map(s => (s || "").toLowerCase());

  let out = text;

  // 1) "коротко і по суті" → стискаємо до N речень
  const wantShort = rules.some(r => r.includes("коротко") || r.includes("по суті"));
  if (wantShort) {
    // ~3–6 речень залежно від factor
    const n = Math.max(2, Math.min(6, Math.round(6 - 3 * factor)));
    const sentences = out
      .replace(/\s+/g, " ")
      .match(/[^.!?]+[.!?]?/g) || [out];
    out = sentences.slice(0, n).join("").trim();
  }

  // 2) "підсумовувати питання" → додати короткий заголовок-рефрейм
  const wantEcho = rules.some(r => r.includes("підсумувати") || r.includes("рефрейм"));
  if (wantEcho) {
    // Витягнемо перший знак питання як короткий ехо-заголовок
    const qMatch = text.match(/([^?]{4,120}\?)/);
    const echo = qMatch ? qMatch[1].trim() : null;
    if (echo) {
      const prepend = `**Запит (коротко):** ${echo}\n\n`;
      // не дублюємо, якщо вже є
      if (!out.startsWith("**Запит (коротко):**")) out = prepend + out;
    }
  }

  // 3) Нормалізація зайвих пустих рядків
  out = out.replace(/\n{3,}/g, "\n\n").trim();

  return out;
}

// Зручний комбайн для інтеграції: додає system-додаток і пост-процесує драфт
export async function selfTunePipeline(env, chatId, { baseSystem, draft }) {
  const insight = await loadLatestInsight(env, chatId);
  const systemAddendum = buildAdaptiveSystem(insight, env);
  const tunedDraft = postProcessDraft(draft, insight, env);
  return { systemAddendum, tunedDraft, insight };
}