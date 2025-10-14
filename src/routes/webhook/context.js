// [2/7] src/routes/webhook/context.js
import { readStatut } from "../../lib/kvChecklist.js";
import { getShortContext, contextToTranscript } from "../../lib/memory.js";

async function loadSelfTune(env, chatId) {
  try {
    if (!env.STATE_KV) return null;
    const key = `insight:latest:${chatId}`;
    const raw = await env.STATE_KV.get(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    const rules = Array.isArray(obj?.analysis?.rules) ? obj.analysis.rules : [];
    const tone  = obj?.analysis?.tone ? String(obj.analysis.tone).trim() : "";
    if (!rules.length && !tone) return null;

    const lines = [];
    if (tone) lines.push(`• Тон розмови користувача: ${tone}.`);
    if (rules.length) {
      lines.push("• Дотримуйся правил:");
      for (const r of rules.slice(0, 5)) lines.push(`  - ${String(r).trim()}`);
    }
    const text = lines.join("\n");
    return text ? `\n\n[Self-Tune]\n${text}\n` : null;
  } catch { return null; }
}

export async function buildSystemHint(env, chatId) {
  const statut = await readStatut(env).catch(() => "");
  const selfTune = chatId ? await loadSelfTune(env, chatId) : null;

  // короткий діалог (останнні кілька реплік)
  const ctxMsgs = await getShortContext(env, chatId, 10);
  const dialogReadable = ctxMsgs?.length ? `[Context]\n${contextToTranscript(ctxMsgs)}` : "";

  const base =
    (statut ? `${statut.trim()}\n\n` : "") +
    "Ти — Senti, помічник у Telegram. Відповідай стисло та дружньо. " +
    "Якщо просять зберегти файл — нагадай про Google Drive та розділ Checklist/Repo.";

  return [base, selfTune || "", dialogReadable || ""].filter(Boolean).join("\n\n");
}
