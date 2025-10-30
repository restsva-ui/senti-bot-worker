// src/lib/autolog.js
// Уніфіковане зберігання прапорця автологування

const KEY = "autolog:enabled";

// Єдиний KV — STATE_KV (щоб не було плутанини з LIKES_KV/SENTI_CACHE)
function pickKV(env) {
  return env.STATE_KV || null;
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