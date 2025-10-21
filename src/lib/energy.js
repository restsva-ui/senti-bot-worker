// src/lib/energy.js
// KV-бекенд "Енергії": баланс користувача + вартість текст/зображення.

function pickKV(env) {
  return env.ENERGY_LOG_KV || env.STATE_KV || env.CHECKLIST_KV || env.LEARN_QUEUE_KV;
}
function toInt(x, def = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

export async function getEnergy(env, userIdRaw) {
  const kv = pickKV(env);
  const userId = String(userIdRaw || env.TELEGRAM_ADMIN_ID || "0");

  const [balStr, costTextStr, costImgStr] = kv
    ? await Promise.all([
        kv.get(`energy:user:${userId}:balance`, "text"),
        kv.get(`energy:cost:text`, "text"),
        kv.get(`energy:cost:image`, "text"),
      ])
    : [null, null, null];

  const balance   = balStr      != null ? toInt(balStr,      toInt(env.ENERGY_MAX, 100))       : toInt(env.ENERGY_MAX, 100);
  const costText  = costTextStr != null ? toInt(costTextStr, toInt(env.ENERGY_COST_TEXT, 1))   : toInt(env.ENERGY_COST_TEXT, 1);
  const costImage = costImgStr  != null ? toInt(costImgStr,  toInt(env.ENERGY_COST_IMAGE, 5))  : toInt(env.ENERGY_COST_IMAGE, 5);

  return { userId, balance, costText, costImage };
}

export async function setEnergyCosts(env, textCost, imageCost) {
  const kv = pickKV(env);
  if (!kv) return { ok: false, error: "kv_not_bound" };
  await kv.put("energy:cost:text", String(toInt(textCost, 1)));
  await kv.put("energy:cost:image", String(toInt(imageCost, 5)));
  return { ok: true };
}

export async function addEnergy(env, userIdRaw, delta) {
  const kv = pickKV(env);
  if (!kv) return { ok: false, error: "kv_not_bound" };
  const userId = String(userIdRaw || env.TELEGRAM_ADMIN_ID || "0");
  const cur = toInt(await kv.get(`energy:user:${userId}:balance`, "text"), toInt(env.ENERGY_MAX, 100));
  const next = Math.max(0, cur + Number(delta || 0));
  await kv.put(`energy:user:${userId}:balance`, String(next));
  return { ok: true, balance: next };
}