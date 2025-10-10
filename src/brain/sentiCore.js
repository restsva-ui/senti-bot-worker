// src/brain/sentiCore.js
// Senti Core — автономна логіка: STATUT → дія → лог у чеклист

import {
  appendChecklist,
  readChecklist,
  readStatut,
} from "../lib/kvChecklist.js";
import { logDeploy } from "../lib/audit.js";

function safe(val, max = 160) {
  const s = String(val ?? "");
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export const SentiCore = {
  // Одноразовий старт (ручний або при першому cron)
  async boot(env, note = "manual") {
    const statut = await readStatut(env);
    await appendChecklist(env, `🤖 brain boot (${note}), statut=${statut ? "present" : "missing"}`);
    return { statut_len: (statut || "").length };
  },

  // Периодичний self-check (cron)
  async selfCheck(env) {
    const statut = await readStatut(env);
    const checklist = await readChecklist(env);

    // Простий «health» маркер у чеклист
    await appendChecklist(env, `🤖 self-check ok | statut:${statut ? "1" : "0"} | len=${(statut || "").length}`);

    // (Місце для подальших правил зі STATUT: парсинг і виконання)
    return {
      ok: true,
      statut_len: (statut || "").length,
      checklist_len: (checklist || "").length,
    };
  },

  // Знімок середовища (без секретів)
  async snapshot(env) {
    const kvBinds = [
      "CHECKLIST_KV", "DEDUP_KV", "OAUTH_KV", "STATE_KV", "TODO_KV", "USER_OAUTH_KV",
    ].filter(k => env[k]).join(",");

    const vars = {
      SERVICE_HOST: env.SERVICE_HOST,
      TELEGRAM_ADMIN_ID: env.TELEGRAM_ADMIN_ID,
      DRIVE_FOLDER_ID: env.DRIVE_FOLDER_ID,
      DEPLOY_ID: env.DEPLOY_ID,
    };

    const line = `📦 env snapshot → host=${safe(vars.SERVICE_HOST)} admin=${vars.TELEGRAM_ADMIN_ID} drive=${vars.DRIVE_FOLDER_ID} deploy=${vars.DEPLOY_ID} | kv=[${kvBinds}]`;
    await appendChecklist(env, line);
    return { kvBinds, vars };
  },

  // Позначити деплой (викликається CI або вручну)
  async markDeploy(env, info = {}) {
    const line = await logDeploy(env, { source: "brain", ...info });
    await appendChecklist(env, `🚀 deploy ${safe(line, 200)}`);
    return { line };
  },
};