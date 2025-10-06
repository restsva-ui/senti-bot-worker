// ===== /log (автологування)
if (chatId && text.startsWith("/log")) {
  const sub = (text.split(" ")[1] || "status").toLowerCase();
  const owner = await isOwner(env, fromId);

  if (!owner && sub !== "status") {
    const reply = "🔒 Керувати автологуванням може лише власник. Використай `/log status` або `/id`.";
    await sendMessage(env, chatId, reply).catch(() => {});
    await logReply(env, chatId);
    return json({ ok: true });
  }

  if (sub === "on") {
    const ok = await setAutolog(env, true);
    const now = await getAutolog(env);
    const reply = ok && now
      ? "🟢 Автологування УВІМКНЕНО. Пиши завдання з префіксом `+`."
      : "⚠️ Не вдалося увімкнути автологування (KV недоступне?).";
    await sendMessage(env, chatId, reply).catch(() => {});
    await logReply(env, chatId);
    return json({ ok: true });
  }

  if (sub === "off") {
    const ok = await setAutolog(env, false);
    const now = await getAutolog(env);
    const reply = ok && !now
      ? "⚪️ Автологування вимкнено."
      : "⚠️ Не вдалося вимкнути автологування (KV недоступне?).";
    await sendMessage(env, chatId, reply).catch(() => {});
    await logReply(env, chatId);
    return json({ ok: true });
  }

  // status
  const enabled = await getAutolog(env);
  await sendMessage(env, chatId, `ℹ️ Автологування: ${enabled ? "УВІМКНЕНО" : "вимкнено"}.`).catch(() => {});
  await logReply(env, chatId);
  return json({ ok: true });
}
