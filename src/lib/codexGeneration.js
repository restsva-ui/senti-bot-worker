// src/codexGeneration.js
// Ядро генерації Codex: Architect + робота з медіа

import { askAnyModel, askVision } from "./modelRouter.js";
import { codexUploadAssetFromUrl } from "./codexDrive.js";

import {
  pickKV,
  nowIso,
  safeJsonParse,
  extractTextFromModel,
  limitCodexText,
} from "./codexUtils.js";

import {
  createProject,
  readMeta,
  listProjects,
  writeSection,
  readSection,
  appendSection,
  nextTaskSeq,
  setCurrentProject,
  getCurrentProject,
  normalizeProjectName,
  UI_AWAIT_KEY,
  IDEA_DRAFT_KEY,
} from "./codexState.js";

import { handleCodexCommand } from "./codexUi.js";

// -------------------- vision-аналіз --------------------
async function analyzeImageForCodex(env, { lang = "uk", imageBase64, question }) {
  const system = `Ти — Senti Codex, технічний аналітик інтерфейсів та макетів. Твоє завдання:
- чітко описати, що на зображенні;
- виділити компоненти UI, сітку, блоки, ієрархію, шрифти, кольори;
- запропонувати, як це зображення може використовуватись у продукті (логотип, банер, екран, іконки тощо).
Не вигадуй код, якщо про це прямо не просять.`;
  const prompt =
    question ||
    "Опиши, що на зображенні, з фокусом на компоненти інтерфейсу, блоки, сітку, шрифти, кольори, структуру верстки.";

  const modelOrder =
    env.MODEL_ORDER_VISION ||
    env.MODEL_ORDER ||
    env.MODEL_ORDER_TEXT;

  const res = await askVision(env, modelOrder, prompt, {
    systemHint: system,
    imageBase64,
    temperature: 0.2,
  });

  const text =
    typeof res === "string"
      ? res
      : res?.choices?.[0]?.message?.content ||
        res?.text ||
        JSON.stringify(res);
  return String(text || "").slice(0, 4000);
}

// -------------------- handleCodexGeneration --------------------
export async function handleCodexGeneration(env, ctx, helpers) {
  const { chatId, userId, msg, textRaw, lang } = ctx;
  const { sendPlain, pickPhoto, tgFileUrl, urlToBase64 } = helpers;
  const kv = pickKV(env);
  if (!kv) {
    await sendPlain(env, chatId, "Codex KV недоступний.");
    return true;
  }

  const awaiting = (await kv.get(UI_AWAIT_KEY(userId), "text")) || "none";

  const hasPhoto = Array.isArray(msg?.photo) && msg.photo.length > 0;
  const hasDocument = !!msg?.document;
  if (awaiting === "none" && !textRaw && (hasPhoto || hasDocument)) {
    await sendPlain(
      env,
      chatId,
      "Я отримав медіа для Codex. Напиши, що саме зробити з цим (наприклад: «зроби логотип», «проаналізуй макет», «згенеруй код сторінки»)."
    );
    return true;
  }

  // ---------- UI-стани ----------
  if (awaiting === "proj_name" && textRaw) {
    const name = textRaw.trim();
    await kv.delete(UI_AWAIT_KEY(userId));
    if (!name) {
      await sendPlain(
        env,
        chatId,
        "Назва порожня. Натисни «Створити проєкт» ще раз і введи коректну."
      );
      return true;
    }
    const metaPrev = await readMeta(env, userId, name);
    if (metaPrev) {
      await sendPlain(
        env,
        chatId,
        `Проєкт "${name}" вже існує. Обери іншу назву або користуйся існуючим.`
      );
      return true;
    }
    await createProject(env, userId, name, "");
    await sendPlain(
      env,
      chatId,
      `✅ Створено проєкт "*${name}*". Опиши ідею (я збережу її в idea.md).`
    );
    await kv.put(UI_AWAIT_KEY(userId), "idea_text", { expirationTtl: 3600 });
    return true;
  }

  if (awaiting === "idea_text" && textRaw) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(
        env,
        chatId,
        "Не бачу активного проєкту. Спочатку створи або обери проєкт."
      );
      await kv.delete(UI_AWAIT_KEY(userId));
      return true;
    }

    const ideaRaw = textRaw.trim();
    if (!ideaRaw) {
      await sendPlain(env, chatId, "Порожній текст. Спробуй ще раз.");
      return true;
    }

    const meta = (await readMeta(env, userId, cur)) || {};
    const projName = normalizeProjectName(meta.name || cur);
    const prevIdea = (await readSection(env, userId, cur, "idea.md")) || "";

    const system = [
      "Ти — Senti Codex Architect.",
      "Твоє завдання — допомогти юзеру сформувати чітку, структурувану, але компактну ідею проєкту.",
      "",
      "Вимоги до результату:",
      "- пиши українською;",
      "- використовуй підзаголовки (Мета, Ключові можливості, Обмеження, Технології, Наступні кроки);",
      "- у кожному розділі не більше 2–3 маркованих пунктів;",
      "- загальний обсяг — до 150–250 слів (приблизно 1 екран в Telegram на телефоні, не більше 1200 символів);",
      "- не вигадуй неможливих речей, опирайся на текст користувача;",
      "- якщо чогось не вистачає — зроби розумні припущення, але познач їх як «припущення».",
    ].join("\n");

    const prompt = [
      `Проєкт: ${projName}`,
      "",
      "Попередній опис (може бути порожнім):",
      prevIdea ? `\"\"\"\n${prevIdea.slice(0, 1500)}\n\"\"\"` : "(ще не було ідеї)",
      "",
      "Новий опис ідеї від користувача:",
      `\"\"\"\n${ideaRaw.slice(0, 2000)}\n\"\"\"`,
      "",
      "Сформуй одну узгоджену, стиснену, структуровану чернетку за цими вимогами.",
    ].join("\n");

    const res = await askAnyModel(
      env,
      env.MODEL_ORDER_TEXT || env.MODEL_ORDER || env.MODEL_ORDER_CODE,
      prompt,
      {
        systemHint: system,
        temperature: 0.3,
      }
    );

    const rawDraft = extractTextFromModel(res).trim() || ideaRaw;
    const draft = limitCodexText(rawDraft, 1400);

    const draftObj = {
      project: cur,
      projectName: projName,
      ideaDraft: draft,
      userIdea: ideaRaw,
      previousIdea: prevIdea,
      createdAt: nowIso(),
    };

    await kv.put(IDEA_DRAFT_KEY(userId), JSON.stringify(draftObj), {
      expirationTtl: 3600,
    });
    await kv.put(UI_AWAIT_KEY(userId), "idea_confirm", { expirationTtl: 3600 });

    const msgLines = [
      `🧠 Чернетка ідеї для проєкту *${projName}*:`,
      "",
      draft,
      "",
      "Якщо все ок — напиши «+» або «зберегти».",
      "Якщо потрібно щось змінити — напиши, що саме переробити.",
    ];
    await sendPlain(env, chatId, msgLines.join("\n"));
    return true;
  }

  if (awaiting === "idea_confirm" && textRaw) {
    const raw = (await kv.get(IDEA_DRAFT_KEY(userId), "text")) || "";
    const draftObj = safeJsonParse(raw) || {};
    const cur = draftObj.project || (await getCurrentProject(env, userId));

    if (!cur) {
      await sendPlain(env, chatId, "Не бачу активного проєкту. Спробуй ще раз.");
      await kv.delete(UI_AWAIT_KEY(userId));
      await kv.delete(IDEA_DRAFT_KEY(userId));
      return true;
    }

    const rawAnswer = textRaw.trim();
    const isConfirm =
      rawAnswer === "+" ||
      /^(\+|ок|добре|так|зберегти|save|ok)\s*$/i.test(rawAnswer);

    if (isConfirm) {
      const finalText = String(draftObj.ideaDraft || "").trim();
      if (!finalText) {
        await sendPlain(env, chatId, "Чернетка порожня, нічого зберігати.");
        await kv.delete(UI_AWAIT_KEY(userId));
        await kv.delete(IDEA_DRAFT_KEY(userId));
        return true;
      }

      await writeSection(env, userId, cur, "idea.md", finalText);
      await appendSection(
        env,
        userId,
        cur,
        "progress.md",
        `- ${nowIso()} — Ідею оновлено через Codex Architect.`
      );

      await kv.delete(UI_AWAIT_KEY(userId));
      await kv.delete(IDEA_DRAFT_KEY(userId));

      await sendPlain(
        env,
        chatId,
        "✅ Ідею збережено в idea.md. Можеш додавати tasks / progress або кидати вимоги для генерації коду."
      );
      return true;
    }

    const meta = (await readMeta(env, userId, cur)) || {};
    const projName = normalizeProjectName(meta.name || cur);
    const prevDraft = String(draftObj.ideaDraft || "");
    const note = textRaw.trim();

    const system2 = [
      "Ти — Senti Codex Architect.",
      "Онови чернетку ідеї з урахуванням коментарів користувача, зберігаючи компактність.",
      "",
      "Вимоги:",
      "- структура та мова ті самі (українська, розділи Мета/Ключові можливості/Обмеження/Технології/Наступні кроки);",
      "- у кожному розділі не більше 2–3 маркованих пунктів;",
      "- загальний обсяг — до 150–250 слів (приблизно 1 екран в Telegram, не більше 1200 символів);",
      "- не викидай важливі деталі без причини, але не роздувай текст.",
    ].join("\n");

    const prompt2 = [
      `Проєкт: ${projName}`,
      "",
      "Попередня чернетка:",
      `\"\"\"\n${prevDraft.slice(0, 3000)}\n\"\"\"`,
      "",
      "Коментарі / правки від користувача:",
      `\"\"\"\n${note.slice(0, 2000)}\n\"\"\"`,
      "",
      "Поверни оновлену, компактну чернетку ідеї.",
    ].join("\n");

    const res2 = await askAnyModel(
      env,
      env.MODEL_ORDER_TEXT || env.MODEL_ORDER || env.MODEL_ORDER_CODE,
      prompt2,
      {
        systemHint: system2,
        temperature: 0.3,
      }
    );

    const newRawDraft = extractTextFromModel(res2).trim() || prevDraft;
    const newDraft = limitCodexText(newRawDraft, 1400);

    const newObj = {
      ...draftObj,
      ideaDraft: newDraft,
      updatedAt: nowIso(),
    };
    await kv.put(IDEA_DRAFT_KEY(userId), JSON.stringify(newObj), {
      expirationTtl: 3600,
    });

    const respLines = [
      `🧠 Оновлена чернетка ідеї для *${projName}*:`,
      "",
      newDraft,
      "",
      "Якщо тепер все ок — напиши «+» або «зберегти».",
      "Якщо ще щось змінити — напиши свої правки.",
    ];
    await sendPlain(env, chatId, respLines.join("\n"));
    return true;
  }

  if (awaiting === "use_name" && textRaw) {
    await kv.delete(UI_AWAIT_KEY(userId));
    const name = textRaw.trim();
    if (!name) {
      await sendPlain(env, chatId, "Порожня назва. Спробуй ще раз.");
      return true;
    }
    const meta = await readMeta(env, userId, name);
    if (!meta) {
      await sendPlain(env, chatId, `Проєкт "${name}" не знайдено.`);
      return true;
    }
    await setCurrentProject(env, userId, name);
    await sendPlain(env, chatId, `✅ Активний проєкт: *${name}*.`);
    return true;
  }

  const curName = await getCurrentProject(env, userId);
  if (!curName) {
    await sendPlain(
      env,
      chatId,
      "Спочатку створи або обери проєкт для Senti Codex."
    );
    return true;
  }

  // /project-команди
  if (textRaw && textRaw.startsWith("/project")) {
    const handled = await handleCodexCommand(
      env,
      chatId,
      userId,
      textRaw,
      sendPlain
    );
    return handled;
  }

  const idea = (await readSection(env, userId, curName, "idea.md")) || "";
  const tasks = (await readSection(env, userId, curName, "tasks.md")) || "";
  const progress =
    (await readSection(env, userId, curName, "progress.md")) || "";

  // Fallback: перший текст як ідея, якщо idea.md ще пуста
  if (
    awaiting === "none" &&
    textRaw &&
    !textRaw.startsWith("/") &&
    !hasPhoto &&
    !hasDocument &&
    (!idea || !idea.trim())
  ) {
    const cur = curName;
    const ideaRaw = textRaw.trim();

    const meta = (await readMeta(env, userId, cur)) || {};
    const projName = normalizeProjectName(meta.name || cur);
    const prevIdea = idea || "";

    const system = [
      "Ти — Senti Codex Architect.",
      "Твоє завдання — допомогти юзеру сформувати чітку, структурувану, але компактну ідею проєкту.",
      "",
      "Вимоги до результату:",
      "- пиши українською;",
      "- використовуй підзаголовки (Мета, Ключові можливості, Обмеження, Технології, Наступні кроки);",
      "- у кожному розділі не більше 2–3 маркованих пунктів;",
      "- загальний обсяг — до 150–250 слів (приблизно 1 екран в Telegram на телефоні, не більше 1200 символів);",
      "- не вигадуй неможливих речей, опирайся на текст користувача;",
      "- якщо чогось не вистачає — зроби розумні припущення, але познач їх як «припущення».",
    ].join("\n");

    const prompt = [
      `Проєкт: ${projName}`,
      "",
      "Попередній опис (може бути порожнім):",
      prevIdea ? `\"\"\"\n${prevIdea.slice(0, 1500)}\n\"\"\"` : "(ще не було ідеї)",
      "",
      "Новий опис ідеї від користувача:",
      `\"\"\"\n${ideaRaw.slice(0, 2000)}\n\"\"\"`,
      "",
      "Сформуй одну узгоджену, компактну, структуровану чернетку.",
    ].join("\n");

    const res = await askAnyModel(
      env,
      env.MODEL_ORDER_TEXT || env.MODEL_ORDER || env.MODEL_ORDER_CODE,
      prompt,
      {
        systemHint: system,
        temperature: 0.3,
      }
    );

    const rawDraft = extractTextFromModel(res).trim() || ideaRaw;
    const draft = limitCodexText(rawDraft, 1400);

    const draftObj = {
      project: cur,
      projectName: projName,
      ideaDraft: draft,
      userIdea: ideaRaw,
      previousIdea: prevIdea,
      createdAt: nowIso(),
    };

    await kv.put(IDEA_DRAFT_KEY(userId), JSON.stringify(draftObj), {
      expirationTtl: 3600,
    });
    await kv.put(UI_AWAIT_KEY(userId), "idea_confirm", { expirationTtl: 3600 });

    const msgLines = [
      `🧠 Чернетка ідеї для проєкту *${projName}*:`,
      "",
      draft,
      "",
      "Якщо все ок — напиши «+» або «зберегти».",
      "Якщо потрібно щось змінити — напиши, що саме переробити.",
    ];
    await sendPlain(env, chatId, msgLines.join("\n"));
    return true;
  }

  const systemHint = [
    "Ти — Senti Codex 3.1 (AI Architect).",
    "Ти поєднуєш ролі: архітектор, senior-розробник і аналітик вимог.",
    "Працюєш у режимі проєкту; зберігай цілісну картину й будуй відповідь так, щоб нею можна було керувати розробкою.",
    "",
    "Коли немає чіткого запиту на конкретний код — спершу дай дуже коротку архітектуру й список наступних кроків (до 10–15 речень загалом).",
    "Коли бачиш фрагменти коду — спочатку короткий огляд, потім пропонуй зміни (diff/рефакторинг), і лише після цього приклади коду.",
    "Для зображень та assets пояснюй, як саме їх краще використати в проєкті (логотип, банер, UI-макет, іконки, контент).",
    "Не вигадуй вміст зовнішніх посилань: якщо ти його не бачиш у тексті — стався до нього як до невідомого ресурсу й кажи про це прямо.",
    "",
    "Відповідь має бути стислою: до 1200–1600 символів, не більше 15–20 речень.",
    "",
    "Контекст проєкту нижче. Використовуй його завжди:",
    "=== ІДЕЯ ПРОЄКТУ ===",
    idea || "(ще не задана)",
    "",
    "=== TASKS (task list) ===",
    tasks || "(ще немає tasks)",
    "",
    "=== PROGRESS (щоденник/журнал) ===",
    progress || "(ще не було progress-записів)",
  ].join("\n");

  const photo = pickPhoto ? pickPhoto(msg) : null;
  const doc = msg?.document || null;

  const assetsSaved = [];

  async function handleAsset(fileId, defaultName, label) {
    try {
      const url = await tgFileUrl(env, fileId);
      const ok = await codexUploadAssetFromUrl(
        env,
        userId,
        curName,
        url,
        defaultName
      );
      if (ok) assetsSaved.push(label);
    } catch {
      // ignore
    }
  }

  if (photo?.file_id) {
    await handleAsset(
      photo.file_id,
      photo.file_name || `photo_${Date.now()}.jpg`,
      "photo"
    );
  }

  if (doc?.file_id) {
    await handleAsset(
      doc.file_id,
      doc.file_name || `doc_${Date.now()}`,
      "document"
    );
  }

  let visionSummary = "";
  if (photo && urlToBase64) {
    try {
      const imgB64 = await urlToBase64(
        env,
        await tgFileUrl(env, photo.file_id)
      );
      const projLabel = curName || "без назви";
      const ideaSnippet = (idea || "").slice(0, 800);
      const qParts = [
        `Ти аналізуєш зображення в контексті проєкту "${projLabel}".`,
        ideaSnippet
          ? "Коротко ідея проєкту:\n" + ideaSnippet
          : "Ідея проєкту ще не сформульована — припусти, що це частина того самого продукту, над яким ми працюємо.",
        "",
        "Опиши, що на зображенні, і поясни, як це можна використати саме в цьому проєкті (аватар, банер, UI-макет, іконки, скріншоти тощо).",
      ];
      visionSummary = await analyzeImageForCodex(env, {
        lang,
        imageBase64: imgB64,
        question: qParts.join("\n"),
      });
    } catch {
      visionSummary = "";
    }
  }

  const userText = String(textRaw || "").trim();
  const parts = [];

  const urls =
    userText ? userText.match(/\bhttps?:\/\/\S+/gi) || [] : [];

  if (assetsSaved.length) {
    parts.push(
      `Assets, додані до проєкту: ${assetsSaved.join(
        ", "
      )}. Використовуй їх у своїх ідеях/коді.`
    );
  }

  if (visionSummary) {
    parts.push("=== ОПИС ЗОБРАЖЕННЯ (VISION) ===");
    parts.push(visionSummary);
  }

  if (urls.length) {
    parts.push("=== ПОСИЛАННЯ ВІД КОРИСТУВАЧА ===");
    parts.push(urls.join("\n"));
  }

  if (userText) {
    parts.push("=== ЗАПИТ КОРИСТУВАЧА ===");
    parts.push(userText);
  } else if (!visionSummary && !assetsSaved.length) {
    parts.push(
      "Немає явного текстового запиту. Зроби огляд поточного стану проєкту та запропонуй 3–5 наступних кроків."
    );
  }

  const finalUserPrompt = parts.join("\n\n").trim();

  const order = env.MODEL_ORDER_CODE || env.MODEL_ORDER || env.MODEL_ORDER_TEXT;
  const res = await askAnyModel(
    env,
    order,
    finalUserPrompt || "Продовжуй",
    {
      systemHint,
      temperature: 0.2,
    }
  );

  const outRaw =
    typeof res === "string"
      ? res
      : res?.choices?.[0]?.message?.content ||
        res?.text ||
        JSON.stringify(res);

  const outText = limitCodexText(String(outRaw || "Не впевнений."), 1600);

  const proj = await readMeta(env, userId, curName);
  if (proj && proj.name) {
    await appendSection(
      env,
      userId,
      proj.name,
      "progress.md",
      `- ${nowIso()} — Відповідь Codex: ${outText.slice(0, 120)}…`
    );
  }
  await sendPlain(env, chatId, outText);
}
