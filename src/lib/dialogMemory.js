// src/lib/dialogMemory.js
// Легка пам'ять діалогу в DIALOG_KV з авто-обрізанням за кількістю ходів і розміром.

const DIALOG_KEY = (uid) => `dlg:${uid}`;

const DLG_CFG = {
  maxTurns: 12,         // максимум ходів, що зберігаємо
  maxBytes: 8_000,      // граничний розмір JSON
  ttlSec: 14 * 24 * 3600 // 14 днів
};

function ensureDialog(env) {
  if (!env.DIALOG_KV) throw new Error("DIALOG_KV binding missing");
  return env.DIALOG_KV;
}

/** Прочитати масив ходів [{ r: "user"|"assistant", c: "..." }, ...] */
export async function readDialog(env, userId) {
  const kv = ensureDialog(env);
  const raw = await kv.get(DIALOG_KEY(userId));
  if (!raw) return [];
  try { return JSON.parse(raw) || []; } catch { return []; }
}

/** Внутрішній запис з обрізанням по розміру та ліміту ходів */
async function writeDialog(env, userId, arr) {
  // ліміт по кількості
  if (arr.length > DLG_CFG.maxTurns) {
    arr.splice(0, arr.length - DLG_CFG.maxTurns);
  }
  // ліміт по байтах
  let s = JSON.stringify(arr);
  if (s.length > DLG_CFG.maxBytes) {
    // приблизне оцінювання, скільки дропнути
    const over = s.length - DLG_CFG.maxBytes;
    const drop = Math.ceil((over / s.length) * arr.length) + 1;
    arr = arr.slice(drop);
    s = JSON.stringify(arr);
  }
  await ensureDialog(env).put(DIALOG_KEY(userId), s, { expirationTtl: DLG_CFG.ttlSec });
}

/** Додати хід у діалог (role: "user" | "assistant") */
export async function pushTurn(env, userId, role, content) {
  const arr = await readDialog(env, userId);
  arr.push({ r: role, c: String(content || "") });
  await writeDialog(env, userId, arr);
}

/** Готовий текстовий хінт для системного промпта з останніх ходів */
export async function buildDialogHint(env, userId) {
  const turns = await readDialog(env, userId);
  if (!turns.length) return "";
  const lines = ["[Context: попередній діалог (останні повідомлення)]"];
  for (const it of turns.slice(-DLG_CFG.maxTurns)) {
    const who = it.r === "user" ? "Користувач" : "Senti";
    lines.push(`${who}: ${it.c}`);
  }
  return lines.join("\n");
}

// Експорт конфіга (може знадобитися іншим модулям)
export const DIALOG_MEMORY_CONFIG = Object.freeze({ ...DLG_CFG });
