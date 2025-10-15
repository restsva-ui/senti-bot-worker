// src/lib/selfTune.js
// Завантаження користувацьких інсайтів (тон, правила) зі STATE_KV.
// Формат очікуваного запису в KV: key = insight:latest:<chatId>
// value приблизно: { analysis: { tone: "...", rules: ["...", ...] } }

function ensureState(env) {
  if (!env.STATE_KV) throw new Error("STATE_KV binding missing");
  return env.STATE_KV;
}

/** Повертає готовий текстовий блок або null, якщо інсайтів нема */
export async function loadSelfTune(env, chatId) {
  try {
    const kv = ensureState(env);
    const raw = await kv.get(`insight:latest:${chatId}`);
    if (!raw) return null;

    const obj = JSON.parse(raw);
    const rules = Array.isArray(obj?.analysis?.rules) ? obj.analysis.rules : [];
    const tone  = obj?.analysis?.tone ? String(obj.analysis.tone).trim() : "";

    if (!rules.length && !tone) return null;

    const lines = [];
    if (tone) lines.push(`• Тон розмови користувача: ${tone}.`);
    if (rules.length) {
      lines.push("• Політики/звички користувача:");
      for (const r of rules.slice(0, 8)) lines.push(`  – ${r}`);
    }
    return lines.join("\n");
  } catch {
    return null;
  }
}