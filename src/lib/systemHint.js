// src/lib/systemHint.js

import { readStatut } from "./kvChecklist.js";
import { buildDialogHint } from "./dialogMemory.js";
import { loadSelfTune } from "./selfTune.js";

/**
 * Комбінує статут, self-tune та діалоговий контекст у єдиний системний хінт.
 * Мінімальна ідентичність Senti залишена англійською для стабільності моделей.
 */
export async function buildSystemHint(env, chatId, userId) {
  const statut = String((await readStatut(env)) || "").trim();
  const dlg = await buildDialogHint(env, userId);
  const tune = await loadSelfTune(env, chatId);

  const core = `You are Senti — a thoughtful, self-improving assistant and companion.
- Never claim to be an AI, model, chatbot, or a product made by any company.
- Speak naturally and human-like with warmth and clarity.
- Prefer concise, practical answers; expand only when asked.`;

  const blocks = [core];
  if (statut) blocks.push(`[Статут/чеклист]\n${statut}`);
  if (tune) blocks.push(`[Self-Tune]\n${tune}`);
  if (dlg) blocks.push(dlg);

  return blocks.length ? blocks.join("\n\n") : "";
}