// src/routes/webhook.js

// ── Helpers ───────────────────────────────────────────────────────────────────
function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

async function sendMessage(env, chatId, text, extra = {}) {
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
  } catch (_) {
    // не валимо вебхук, якщо Telegram тимчасово недоступний
  }
}

async function logReply(env, chatId) {
  // зберігаємо timestamp останньої відповіді — в STATE_KV
  try {
    await env.STATE_KV.put(`last-reply:${chatId}`, new Date().toISOString(), {
      expirationTtl: 60 * 60 * 24, // 1 доба
    });
  } catch (_) {}
}

async function isOwner(env, fromId) {
  // підтримуємо один ID або список через кому
  try {
    const raw = String(env.OWNER_ID ?? "").trim();
    if (!raw) return false;
    const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return list.includes(String(fromId).trim());
  } catch {
    return false;
  }
}

// ── Автологування: прапор у STATE_KV ─────────────────────────────────────────
const AUTOLOG_KEY = "autolog:enabled";

async function getAutolog(env) {
  try {
    const val = await env.STATE_KV.get(AUTOLOG_KEY);
    return val === "1";
  } catch {
    return false;
  }
}

async function setAutolog(env, on) {
  try {
    await env.STATE_KV.put(AUTOLOG_KEY, on ? "1" : "0", {
      expirationTtl: 60 * 60 * 24 * 365, // 1 рік
    });
    return true;
  } catch {
    return false;
  }
}

// ── Основний обробник вебхука ────────────────────────────────────────────────
export default async function webhook(request, env, ctx) {
  // 1) зчитуємо апдейт Telegram
  let update;
  try {
    update = await request.json();
  } catch {
    return json({ ok: false, error: "bad json" }, { status: 400 });
  }

  // 2) базова інформація
  const msg =
    update.message ||
    update.edited_message ||
    update.callback_query?.message ||
    null;

  const chatId = msg?.chat?.id;
  const fromId =
    update.message?.from?.id ??
    update.edited_message?.from?.id ??
    update.callback_query?.from?.id ??
    null;

  const textRaw =
    update.message?.text ??
    update.edited_message?.text ??
    update.callback_query?.data ??
    "";

  const text = (textRaw || "").trim();
  if (!chatId) return json({ ok: true });

  // ── /id ────────────────────────────────────────────────────────────────────
  if (text === "/id") {
    await sendMessage(env, chatId, `👤 Твій Telegram ID: \`${fromId}\``);
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // ── /kvtest — перевірка STATE_KV (лише власник) ───────────────────────────
  if (text === "/kvtest") {
    if (!(await isOwner(env, fromId))) {
      await sendMessage(env, chatId, "🔒 Лише власник.");
      await logReply(env, chatId);
      return json({ ok: true });
    }
    const key = `kvtest:${chatId}`;
    const val = `ts=${Date.now()}`;
    let putOk = true,
      getOk = true,
      getVal = null,
      errPut = "",
      errGet = "";

    try {
      await env.STATE_KV.put(key, val, { expirationTtl: 3600 });
    } catch (e) {
      putOk = false;
      errPut = String(e);
    }
    try {
      getVal = await env.STATE_KV.get(key);
      getOk = !!getVal;
    } catch (e) {
      getOk = false;
      errGet = String(e);
    }

    await sendMessage(
      env,
      chatId,
      [
        "🧪 KV test (STATE_KV):",
        `• put: ${putOk ? "OK" : "FAIL"}${putOk ? "" : ` — ${errPut}`}`,
        `• get: ${getOk ? "OK" : "FAIL"}${
          getOk ? ` — ${getVal}` : ` — ${errGet}`
        }`,
      ].join("\n")
    );
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // ── /log (автологування) ───────────────────────────────────────────────────
  if (text.startsWith("/log")) {
    const sub = (text.split(" ")[1] || "status").toLowerCase();
    const owner = await isOwner(env, fromId);

    if (!owner && sub !== "status") {
      await sendMessage(
        env,
        chatId,
        "🔒 Керувати автологуванням може лише власник. Використай `/log status` або `/id`."
      );
      await logReply(env, chatId);
      return json({ ok: true });
    }

    if (sub === "on") {
      const ok = await setAutolog(env, true);
      const now = await getAutolog(env);
      await sendMessage(
        env,
        chatId,
        ok && now
          ? "🟢 Автологування УВІМКНЕНО. Пиши завдання з префіксом `+`."
          : "⚠️ Не вдалося увімкнути автологування (KV недоступне?)."
      );
      await logReply(env, chatId);
      return json({ ok: true });
    }

    if (sub === "off") {
      const ok = await setAutolog(env, false);
      const now = await getAutolog(env);
      await sendMessage(
        env,
        chatId,
        ok && !now
          ? "⚪️ Автологування вимкнено."
          : "⚠️ Не вдалося вимкнути автологування (KV недоступне?)."
      );
      await logReply(env, chatId);
      return json({ ok: true });
    }

    // status
    const enabled = await getAutolog(env);
    await sendMessage(
      env,
      chatId,
      `ℹ️ Автологування: ${enabled ? "УВІМКНЕНО" : "вимкнено"}.`
    );
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // ── інші дрібні команди ────────────────────────────────────────────────────
  if (text === "/ping") {
    await sendMessage(env, chatId, "🏓 Pong!");
    await logReply(env, chatId);
    return json({ ok: true });
  }

  if (text === "/help") {
    await sendMessage(
      env,
      chatId,
      "/help → /ping /id /kvtest /log status|on|off"
    );
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // дефолт
  return json({ ok: true });
}