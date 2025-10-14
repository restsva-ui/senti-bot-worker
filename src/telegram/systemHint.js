// src/telegram/systemHint.js
import { readStatut } from "../lib/kvChecklist.js";
import { toneHint } from "../lib/tone.js";
import { buildDialogHint } from "./dialog.js";

function langName(l) {
  return { uk: "Ukrainian", ru: "Russian", de: "German", en: "English (US)", fr: "French" }[l] || "English (US)";
}

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
    if (tone) lines.push(`• User tone: ${tone}.`);
    if (rules.length) {
      lines.push("• Follow these rules:");
      for (const r of rules.slice(0, 5)) lines.push(`  - ${String(r).trim()}`);
    }
    const text = lines.join("\n");
    return text ? `\n\n[Self-Tune]\n${text}\n` : null;
  } catch {
    return null;
  }
}

export async function buildSystemHint(env, chatId, userId, lang, extra = "") {
  const statut = await readStatut(env).catch(() => "");
  const selfTune = chatId ? await loadSelfTune(env, chatId) : null;
  const dialogCtx = userId ? await buildDialogHint(env, userId) : "";
  const tone = await toneHint(env, chatId, lang);

  const style =
    `Always reply in ${langName(lang)}.\n` +
    "Prefer a conversational, friendly tone (not formal). Short, clear sentences. Emojis only when natural.";

  const base =
    (statut ? `${statut.trim()}\n\n` : "") +
    "You are Senti, a Telegram assistant. If user asks to save a file — remind about Google Drive and Checklist/Repo.";

  const parts = [base, style, tone, selfTune || "", dialogCtx || "", extra || ""].filter(Boolean);
  return parts.join("\n\n");
}
