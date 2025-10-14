// src/telegram/dialog.js
const DIALOG_KEY = (uid) => `dlg:${uid}`;
const DLG_CFG = { maxTurns: 12, maxBytes: 8_000, ttlSec: 14 * 24 * 3600 };
function ensureDialog(env) { return env.DIALOG_KV || null; }

export async function readDialog(env, userId) {
  const kv = ensureDialog(env); if (!kv) return [];
  try { const raw = await kv.get(DIALOG_KEY(userId)); if (!raw) return []; const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : []; }
  catch { return []; }
}
function trimDialog(arr) {
  let out = Array.isArray(arr) ? arr.slice(-DLG_CFG.maxTurns) : [];
  let s = new TextEncoder().encode(JSON.stringify(out)).length;
  while (out.length > 4 && s > DLG_CFG.maxBytes) { out = out.slice(2); s = new TextEncoder().encode(JSON.stringify(out)).length; }
  return out;
}
export async function writeDialog(env, userId, arr) {
  const kv = ensureDialog(env); if (!kv) return false;
  const val = JSON.stringify(trimDialog(arr));
  try { await kv.put(DIALOG_KEY(userId), val, { expirationTtl: DLG_CFG.ttlSec }); return true; } catch { return false; }
}
export async function pushDialog(env, userId, role, content) {
  const now = Date.now();
  const arr = await readDialog(env, userId);
  arr.push({ r: role, c: String(content || "").slice(0, 1500), t: now });
  return await writeDialog(env, userId, arr);
}
export async function buildDialogHint(env, userId) {
  const turns = await readDialog(env, userId);
  if (!turns.length) return "";
  const lines = ["[Context: previous dialog (last messages)]"];
  for (const it of turns.slice(-DLG_CFG.maxTurns)) {
    const who = it.r === "user" ? "User" : "Senti";
    lines.push(`${who}: ${it.c}`);
  }
  return lines.join("\n");
}
