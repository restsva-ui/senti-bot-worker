// src/brain/sentiCore.js
import { appendChecklist, readChecklist, readStatut } from "../lib/kvChecklist.js";

export const SentiCore = {
  async boot(env, who = "sys") {
    await appendChecklist(env, `brain.boot by=${who}`);
    return { status: "ok", who };
  },

  async selfCheck(env) {
    const statut = await readStatut(env);
    const ch = await readChecklist(env);
    return { statut_bytes: statut.length, checklist_bytes: ch.length };
  },

  async snapshot(env) {
    const info = {
      service: env.SERVICE_HOST || "",
      ts: new Date().toISOString(),
    };
    await appendChecklist(env, `snapshot: ${JSON.stringify(info)}`);
    return { ok: true, info };
  },
};