// src/telegram/api.ts
export type CfEnv = { TELEGRAM_BOT_TOKEN?: string };

function tgBase(env: CfEnv) {
  const token =
    env.TELEGRAM_BOT_TOKEN ??
    (globalThis as any).TELEGRAM_BOT_TOKEN ??
    (globalThis as any).BOT_TOKEN;

  if (!token) {
    console.error("[tg] BOT TOKEN MISSING");
    throw new Error("BOT TOKEN MISSING");
  }

  const masked = token.slice(0, 7) + "..." + token.slice(-4);
  console.log("[tg] using token:", masked);

  const base = `https://api.telegram.org/bot${token}`;
  return { base };
}

export async function sendMessage(
  env: CfEnv,
  chat_id: number | string,
  text: string,
  extra: Record<string, any> = {}
) {
  const { base } = tgBase(env);
  const url = `${base}/sendMessage`;
  const body = { chat_id, text, ...extra };

  console.log("[tg] sendMessage ->", { chat_id, text });
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  let data: any = null;
  try { data = await res.json(); } catch {}

  if (!res.ok || data?.ok === false) {
    console.error("[tg] sendMessage FAIL", { status: res.status, data });
    throw new Error("sendMessage failed");
  }

  console.log("[tg] sendMessage OK");
  return data;
}

export async function answerCallback(env: CfEnv, callback_query_id: string, text="✅") {
  const { base } = tgBase(env);
  const url = `${base}/answerCallbackQuery`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id, text }),
  });

  let data: any = null;
  try { data = await res.json(); } catch {}
  if (!res.ok || data?.ok === false) {
    console.error("[tg] answerCallback FAIL", { status: res.status, data });
    throw new Error("answerCallback failed");
  }
  console.log("[tg] answerCallback OK");
  return data;
}