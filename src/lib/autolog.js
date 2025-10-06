// Уніфіковане зберігання прапорця автологування

const KEY = "autolog:enabled";

// Вибираємо правильний KV з кількох можливих назв биндингів.
// За скрінами у тебе: LIKES_KV → senti-state, SENTI_CACHE → senti-cache.
function pickKV(env) {
  return env.SENTI_STATE || env.LIKES_KV || env.SENTI_CACHE || null;
}

export async function getAutolog(env) {
  const kv = pickKV(env);
  if (!kv) return false;
  const v = await kv.get(KEY);
  return v === "1" || v === "true";
}

export async function setAutolog(env, enabled) {
  const kv = pickKV(env);
  if (!kv) return false;
  await kv.put(KEY, enabled ? "1" : "0");
  return true;
}
