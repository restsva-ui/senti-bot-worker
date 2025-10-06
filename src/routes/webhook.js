// src/routes/webhook.js

// ── Helpers ───────────────────────────────────────────────────────────────────
function json(data, init = {}) {
  const headers = { "content-type": "application/json; charset=utf-8" };
  return new Response(JSON.stringify(data), { headers, ...init });
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
    // ігноруємо помилки відправки, щоб не ламати відповідь вебхука
  }
}

async function logReply(env, chatId) {
  // легкий "пінг" у логах + можливе майбутнє розширення
  // (зараз no-op, але залишаємо точку розширення)
  try {
    await env.SENTI_CACHE.put(
      `last-reply:${chatId}`,
      new Date().toISOString(),
      { expirationTtl: 60 * 60 * 24 } // 1 доба
    );
  } catch (_) {}
}

async function isOwner(env, fromId) {
  try {
    const ownerStr = env.OWNER_ID ?? "";
    return ownerStr && ownerStr.trim() === String(fromId).trim();
  } catch {
    return false;
  }
}

// Зберігаємо прапор автологування в KV (namespace: SENTI_CACHE)
const AUTOLOG_KEY = "autolog:enabled";

async function getAutolog(env) {
  try {
    const val = await env.SENTI_CACHE.get(AUTOLOG_KEY);
    return val === "1";
  } catch {
    return false;
  }
}

async function setAutolog(env, on) {
  try {
    if (on) {
      await env.SENTI_CACHE.put(AUTOLOG_KEY, "1");
    } else {
      await env.SENTI_CACHE.put(AUTOLOG_KEY, "0");
    }
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

  // 2) витягаємо базову інформацію
  const msg = update.message || update.edited_message || update.callback_query?.message || null;
  const chatId = msg?.chat?.id;
  const fromId = (update.message?.from?.id)
    ?? (update.edited_message?.from?.id)
    ?? (update.callback_query?.from?.id)
    ?? null;

  const textRaw =
    update.message?.text ??
    update.edited_message?.text ??
    update.callback_query?.data ??
    "";

  const text = (textRaw || "").trim();

  // Якщо не вистачає обов'язкових полів — просто відповідаємо OK
  if (!chatId) return json({ ok: true });

  // ── Команда /id для зручності перевірки власника ───────────────────────────
  if (text === "/id") {
    await sendMessage(env, chatId, `👤 Твій Telegram ID: \`${fromId}\``);
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // ── /log (автологування) ───────────────────────────────────────────────────
  if (text.startsWith("/log")) {
    const sub = (text.split(" ")[1] || "status").toLowerCase();
    const owner = await isOwner(env, fromId);

    if (!owner && sub !== "status") {
      const reply =
        "🔒 Керувати автологуванням може лише власник. Використай `/log status` або `/id`.";
      await sendMessage(env, chatId, reply).catch(() => {});
      await logReply(env, chatId);
      return json({ ok: true });
    }

    if (sub === "on") {
      const ok = await setAutolog(env, true);
      const now = await getAutolog(env);
      const reply =
        ok && now
          ? "🟢 Автологування УВІМКНЕНО. Пиши завдання з префіксом `+`."
          : "⚠️ Не вдалося увімкнути автологування (KV недоступне?).";
      await sendMessage(env, chatId, reply).catch(() => {});
      await logReply(env, chatId);
      return json({ ok: true });
    }

    if (sub === "off") {
      const ok = await setAutolog(env, false);
      const now = await getAutolog(env);
      const reply =
        ok && !now
          ? "⚪️ Автологування вимкнено."
          : "⚠️ Не вдалося вимкнути автологування (KV недоступне?).";
      await sendMessage(env, chatId, reply).catch(() => {});
      await logReply(env, chatId);
      return json({ ok: true });
    }

    // status
    const enabled = await getAutolog(env);
    await sendMessage(
      env,
      chatId,
      `ℹ️ Автологування: ${enabled ? "УВІМКНЕНО" : "вимкнено"}.`
    ).catch(() => {});
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // ── Додаткові прості відповіді (не обов'язково) ────────────────────────────
  if (text === "/ping") {
    await sendMessage(env, chatId, "🏓 Pong!");
    await logReply(env, chatId);
    return json({ ok: true });
  }

  if (text === "/help") {
    await sendMessage(
      env,
      chatId,
      "/help → /ping /mem /reset /status /todo /log"
    );
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // За замовчуванням просто OK (нічого не робимо)
  return json({ ok: true });
}