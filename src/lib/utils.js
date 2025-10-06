export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

export async function sendMessage(env, chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    ...extra,
  };
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (_) {}
}

export async function logReply(env, chatId) {
  try {
    await env.STATE_KV.put(`last-reply:${chatId}`, new Date().toISOString(), {
      expirationTtl: 60 * 60 * 24,
    });
  } catch (_) {}
}

export async function isOwner(env, fromId) {
  try {
    const raw = String(env.OWNER_ID ?? "").trim();
    if (!raw) return false;
    const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return list.includes(String(fromId).trim());
  } catch {
    return false;
  }
}

// автологування прапорець у STATE_KV
const AUTOLOG_KEY = "autolog:enabled";

export async function getAutolog(env) {
  try {
    const v = await env.STATE_KV.get(AUTOLOG_KEY);
    return v === "1";
  } catch {
    return false;
  }
}

export async function setAutolog(env, on) {
  try {
    await env.STATE_KV.put(AUTOLOG_KEY, on ? "1" : "0", {
      expirationTtl: 60 * 60 * 24 * 365,
    });
    return true;
  } catch {
    return false;
  }
}