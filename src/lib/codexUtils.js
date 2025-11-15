/* Senti Codex — спільні утиліти */

export function pickKV(env) {
  // Для Codex використовуємо один спільний KV
  return (
    env.STATE_KV ||
    env.CHECKLIST_KV ||
    env.ENERGY_LOG_KV ||
    env.LEARN_QUEUE_KV ||
    env.TODO_KV ||
    env.DIALOG_KV
  );
}

export function nowIso() {
  return new Date().toISOString();
}

export function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function extractTextFromModel(res) {
  if (!res) return "";
  if (typeof res === "string") return res;
  if (res.text) return res.text;
  if (
    res.choices &&
    res.choices[0] &&
    res.choices[0].message &&
    res.choices[0].message.content
  ) {
    return res.choices[0].message.content;
  }
  return JSON.stringify(res);
}

/**
 * Обмеження довжини відповіді Codex.
 * maxLen ≈ 1200–1600 символів — 1 екран на телефоні.
 */
export function limitCodexText(text, maxLen = 1600) {
  const src = String(text || "");
  if (src.length <= maxLen) return src;

  const shortened = src.slice(0, maxLen);
  return (
    shortened +
    "\n\n…(Senti Codex скоротив відповідь, щоб вона була компактною. " +
    "Напиши, що саме розгорнути детальніше.)"
  );
}
