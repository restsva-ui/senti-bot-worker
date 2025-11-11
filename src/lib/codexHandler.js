// admin-style команди всередині codex mode
async function handleCodexCommand(env, chatId, userId, textRaw, sendPlain) {
  if (textRaw === "/clear_last") {
    const arr = await loadCodexMem(env, userId);
    if (!arr.length) {
      await sendPlain(env, chatId, "Немає файлів для видалення.");
    } else {
      arr.pop();
      const kv = env.STATE_KV || env.CHECKLIST_KV;
      if (kv) await kv.put(CODEX_MEM_KEY(userId), JSON.stringify(arr));
      await sendPlain(env, chatId, "Останній файл прибрано.");
    }
    return true;
  }
  if (textRaw === "/clear_all") {
    await clearCodexMem(env, userId);
    await sendPlain(env, chatId, "Весь проєкт очищено.");
    return true;
  }
  if (textRaw === "/summary") {
    const arr = await loadCodexMem(env, userId);
    if (!arr.length) {
      await sendPlain(env, chatId, "У проєкті поки що порожньо.");
    } else {
      const lines = arr.map((f) => `- ${f.filename}`).join("\n");
      await sendPlain(env, chatId, `Файли:\n${lines}`);
    }
    return true;
  }
  return false;
}

// головний генератор (те, що було у webhook.js)
async function handleCodexGeneration(env, ctx, helpers) {
  const {
    chatId,
    userId,
    msg,
    textRaw,
    lang,
  } = ctx;

  const {
    getEnergy,
    spendEnergy,
    energyLinks,
    sendPlain,
    pickPhoto,
    tgFileUrl,
    urlToBase64,
    describeImage,
    sendDocument,
    startPuzzleAnimation,
    editMessageText,
  } = helpers;

  const cur = await getEnergy(env, userId);
  const need = Number(cur.costText ?? 2);
  if ((cur.energy ?? 0) < need) {
    const links = energyLinks(env, userId);
    await sendPlain(
      env,
      chatId,
      (lang && lang.startsWith("uk"))
        ? `Потрібно енергії: ${need}. Отримати: ${links.energy}`
        : `Need energy: ${need}. Get: ${links.energy}`
    );
    return true;
  }

  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  let indicatorId = null;
  if (token) {
    const r = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "🧩 Працюю над кодом…",
        }),
      }
    );
    const d = await r.json().catch(() => null);
    indicatorId = d?.result?.message_id || null;
  }

  await spendEnergy(env, userId, need, "codex");

  let userPrompt = textRaw || "";

  // фото → опис → додаємо в промпт
  const photoInCodex = pickPhoto(msg);
  if (photoInCodex) {
    try {
      const imgUrl = await tgFileUrl(env, photoInCodex.file_id);
      const imgBase64 = await urlToBase64(imgUrl);
      const vRes = await describeImage(env, {
        chatId,
        tgLang: msg.from?.language_code,
        imageBase64: imgBase64,
        question:
          "Опиши це зображення так, щоб за описом можна було написати HTML/JS/CSS проєкт.",
        modelOrder:
          "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-vision-instruct",
      });
      const imgDesc = vRes?.text || "";
      userPrompt =
        (userPrompt ? userPrompt + "\n\n" : "") +
        "Ось опис зображення користувача, використай його в коді:\n" +
        imgDesc;
    } catch {
      // пропускаємо
    }
  }

  const animSignal = { done: false };
  if (indicatorId) {
    startPuzzleAnimation(env, chatId, indicatorId, animSignal);
  }

  let codeText;
  if (/тетріс|tetris/i.test(userPrompt)) {
    codeText = buildTetrisHtml();
  } else {
    const ans = await runCodex(env, userPrompt);
    const { code } = extractCodeAndLang(ans);
    codeText = code;
  }

  const filename = "codex.html";
  await saveCodexMem(env, userId, { filename, content: codeText });
  await sendDocument(env, chatId, filename, codeText, "Ось готовий файл 👇");

  if (indicatorId) {
    animSignal.done = true;
    await editMessageText(env, chatId, indicatorId, "✅ Готово");
  }

  return true;
}

export {
  CODEX_MEM_KEY,
  setCodexMode,
  getCodexMode,
  clearCodexMem,
  handleCodexCommand,
  handleCodexGeneration,
  buildTetrisHtml,
};
