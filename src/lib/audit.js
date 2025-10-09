// src/lib/audit.js
// Хартбіт/деплойнoт — тепер у KV (без Google Drive)

import { appendChecklist } from "./kvChecklist.js";

function ts() {
  return new Date().toISOString();
}

export async function logHeartbeat(env, tag = "cron") {
  const line = `heartbeat ${tag} @ ${ts()}`;
  await appendChecklist(env, line);
  return line;
}

export async function logDeploy(env, { source="ci", actor="", deployId="" } = {}) {
  const line = `deploy note | source=${source} actor=${actor} id=${deployId} @ ${ts()}`;
  await appendChecklist(env, line);
  return line;
}