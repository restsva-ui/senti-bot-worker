const KEY = (uid) => `mode:learn:${uid}`;

export async function setLearnMode(env, userId, on) {
  if (!env.STATE_KV) return;
  try { await env.STATE_KV.put(KEY(userId), on ? "1" : "0", { expirationTtl: 60*60*24*14 }); } catch {}
}

export async function getLearnMode(env, userId) {
  if (!env.STATE_KV) return false;
  try { return (await env.STATE_KV.get(KEY(userId))) === "1"; } catch { return false; }
}