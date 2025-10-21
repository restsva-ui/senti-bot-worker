// src/lib/energy.js
// KV-бекенд "Енергії": баланс користувача + конфіг/вартість.
// Використовується з /routes/webhook.js та /routes/adminEnergy.js

/* ───────────── Helpers ───────────── */

function pickKV(env) {
  // пріоритет там, де найменше колізій з іншими даними
  return env.ENERGY_LOG_KV || env.STATE_KV || env.CHECKLIST_KV || env.LEARN_QUEUE_KV;
}
function toInt(x, def = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}
function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

/* ───────────── Ключі ───────────── */

const K = {
  userBal: (uid) => `energy:user:${uid}:balance`,
  costText: `energy:cost:text`,
  costImage: `energy:cost:image`,
  cfgMax: `energy:cfg:max`,
  cfgLow: `energy:cfg:low`,
  cfgRecover: `energy:cfg:recover_per_min`,
};

/* ───────────── Конфіг (ENV + KV override) ───────────── */

async function readConfig(env, kv) {
  // дефолти з env
  const envMax = toInt(env.ENERGY_MAX, 100);
  const envLow = toInt(env.ENERGY_LOW_THRESHOLD, 10);
  const envRecover = toInt(env.ENERGY_RECOVER_PER_MIN, 1);
  const envCostText = toInt(env.ENERGY_COST_TEXT, 1);
  const envCostImage = toInt(env.ENERGY_COST_IMAGE, 5);

  if (!kv) {
    return {
      max: envMax,
      low: envLow,
      recoverPerMin: envRecover,
      costText: envCostText,
      costImage: envCostImage,
    };
  }

  const [kvMax, kvLow, kvRec, kvCT, kvCI] = await Promise.all([
    kv.get(K.cfgMax, "text"),
    kv.get(K.cfgLow, "text"),
    kv.get(K.cfgRecover, "text"),
    kv.get(K.costText, "text"),
    kv.get(K.costImage, "text"),
  ]);

  return {
    max: kvMax != null ? toInt(kvMax, envMax) : envMax,
    low: kvLow != null ? toInt(kvLow, envLow) : envLow,
    recoverPerMin: kvRec != null ? toInt(kvRec, envRecover) : envRecover,
    costText: kvCT != null ? toInt(kvCT, envCostText) : envCostText,
    costImage: kvCI != null ? toInt(kvCI, envCostImage) : envCostImage,
  };
}

/* ───────────── Публічне API ───────────── */

/** Отримати стан енергії користувача */
export async function getEnergy(env, userIdRaw) {
  const kv = pickKV(env);
  const userId = String(userIdRaw || env.TELEGRAM_ADMIN_ID || "0");
  const cfg = await readConfig(env, kv);

  let bal = cfg.max; // дефолт якщо немає KV
  if (kv) {
    const raw = await kv.get(K.userBal(userId), "text");
    bal = raw != null ? toInt(raw, cfg.max) : cfg.max;
  }

  // безпека меж
  bal = clamp(bal, 0, cfg.max);

  return {
    userId,
    energy: bal,
    max: cfg.max,
    low: cfg.low,
    recoverPerMin: cfg.recoverPerMin,
    costText: cfg.costText,
    costImage: cfg.costImage,
  };
}

/** Витратити енергію (kind: "text" | "image") */
export async function spendEnergy(env, userIdRaw, kind = "text") {
  const kv = pickKV(env);
  const userId = String(userIdRaw || env.TELEGRAM_ADMIN_ID || "0");
  const cfg = await readConfig(env, kv);
  const cost = kind === "image" ? cfg.costImage : cfg.costText;

  if (!kv) {
    // якщо немає KV — вважаємо безлімітним
    return { ok: true, balance: cfg.max, cost, unlimited: true };
  }

  const cur = toInt(await kv.get(K.userBal(userId), "text"), cfg.max);

  if (cur < cost) {
    return { ok: false, error: "low_energy", balance: clamp(cur, 0, cfg.max), cost };
  }

  const next = clamp(cur - cost, 0, cfg.max);
  await kv.put(K.userBal(userId), String(next));
  return { ok: true, balance: next, cost };
}

/** Ручне встановлення вартостей */
export async function setEnergyCosts(env, textCost, imageCost) {
  const kv = pickKV(env);
  if (!kv) return { ok: false, error: "kv_not_bound" };
  await kv.put(K.costText, String(toInt(textCost, 1)));
  await kv.put(K.costImage, String(toInt(imageCost, 5)));
  return { ok: true };
}

/** Додати/зняти довільну кількість енергії (delta може бути від’ємною) */
export async function addEnergy(env, userIdRaw, delta) {
  const kv = pickKV(env);
  if (!kv) return { ok: false, error: "kv_not_bound" };

  const userId = String(userIdRaw || env.TELEGRAM_ADMIN_ID || "0");
  const cfg = await readConfig(env, kv);
  const cur = toInt(await kv.get(K.userBal(userId), "text"), cfg.max);
  const next = clamp(cur + Number(delta || 0), 0, cfg.max);
  await kv.put(K.userBal(userId), String(next));
  return { ok: true, balance: next };
}

/** Відновити енергію, ніби минуло N хвилин */
export async function recoverEnergy(env, userIdRaw, minutes = 1) {
  const kv = pickKV(env);
  if (!kv) return { ok: false, error: "kv_not_bound" };

  const userId = String(userIdRaw || env.TELEGRAM_ADMIN_ID || "0");
  const cfg = await readConfig(env, kv);
  const cur = toInt(await kv.get(K.userBal(userId), "text"), cfg.max);
  const delta = toInt(minutes, 0) * cfg.recoverPerMin;
  const next = clamp(cur + delta, 0, cfg.max);
  await kv.put(K.userBal(userId), String(next));
  return { ok: true, balance: next };
}