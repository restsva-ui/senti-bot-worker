// src/lib/audit.js
import { appendToChecklist, getAccessToken, driveList } from "./drive.js";

/** Стислий ISO-час */
const now = () => new Date().toISOString();

/** Запис у чеклист з сервісного адмін-диску */
async function writeLine(env, line) {
  const token = await getAccessToken(env);
  await appendToChecklist(env, token, line);
}

/** Heartbeat (викликається кроном або вручну) */
export async function logHeartbeat(env, note = "") {
  let extra = "";
  try {
    const token = await getAccessToken(env);
    const files = await driveList(env, token);
    const n = Array.isArray(files?.files) ? files.files.length : 0;
    extra = ` files=${n}`;
  } catch (e) {
    extra = ` drive_err=${String(e).slice(0, 100)}`;
  }
  const line = `⏱️ heartbeat ${now()} host=${env.SERVICE_HOST}${extra}${note ? ` ${note}` : ""}`;
  await writeLine(env, line);
  return line;
}

/**
 * Нотатка про деплой (викликається з CI або вручну).
 * info = { source?, commit?, actor?, deployId? }
 */
export async function logDeploy(env, info = {}) {
  const deployId = info.deployId || env.DEPLOY_ID || "";
  const pieces = [
    "🚀 deploy", now(),
    `host=${env.SERVICE_HOST}`,
    deployId ? `deploy=${deployId}` : "",
    info.commit ? `commit=${info.commit}` : "",
    info.actor ? `by=${info.actor}` : "",
    info.source ? `src=${info.source}` : "",
  ].filter(Boolean);
  const line = pieces.join(" ");
  await writeLine(env, line);
  return line;
}