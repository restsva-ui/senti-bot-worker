// src/lib/driveMode.js
// Вмикання/вимикання режиму збереження вкладень у Google Drive (через STATE_KV)

const DRIVE_MODE_KEY = (uid) => `drive_mode:${uid}`;

function ensureState(env) {
  if (!env.STATE_KV) throw new Error("STATE_KV binding missing");
  return env.STATE_KV;
}

/** Увімкнути/вимкнути режим диска для userId (TTL 1 година) */
export async function setDriveMode(env, userId, on) {
  await ensureState(env).put(DRIVE_MODE_KEY(userId), on ? "1" : "0", { expirationTtl: 3600 });
}

/** Перевірити, чи увімкнено режим диска */
export async function getDriveMode(env, userId) {
  return (await ensureState(env).get(DRIVE_MODE_KEY(userId))) === "1";
}