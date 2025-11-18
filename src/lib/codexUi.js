// src/lib/codexUi.js
// Клавіатура Codex, inline-UI та /project-команди

import {
  createProject,
  readMeta,
  listProjects,
  deleteProject,
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

import { codexSyncSection } from "./codexDrive.js"; // синхронізація секцій у Drive

// -------------------- опис режиму Codex --------------------
const CODEX_MODE_INLINE = {
  text:
    "🧠 Senti Codex увімкнено. Натисни «Створити проєкт» — і я увімкну режим проєкту: збиратиму ідеї, посилання, матеріали, все збережу в idea.md, tasks.md та progress.md. Або обери існуючий проєкт.",
};

// -------------------- callback data --------------------
export const CB = {
  NEW: "codex:new",
  LIST: "codex:list",
  USE: "codex:use",
  STATUS: "codex:status",
  IDEA: "codex:idea",
  SNAPSHOT: "codex:snapshot",
  FILES: "codex:files",
};

const CB_USE_PREFIX = "codex:use:";
const CB_DELETE_PREFIX = "codex:del:";

// -------------------- клавіатура Codex --------------------
export function buildCodexKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "➕ Створити проєкт", callback_data: CB.NEW },
        { text: "📂 Обрати проєкт", callback_data: CB.USE },
      ],
      [
        { text: "📊 Статус", callback_data: CB.STATUS },
        { text: "💡 Ідея", callback_data: CB.IDEA },
      ],
      [
        { text: "📁 Файли", callback_data: CB.FILES },
        { text: "📤 Snapshot", callback_data: CB.SNAPSHOT },
      ],
    ],
  };
}

// -------------------- inline UI --------------------
export async function handleCodexUi(
  env,
  chatId,
  userId,
  { cbData },
  helpers = {}
) {
  const { sendPlain, sendInline, editInline } = helpers;

  // Безпечні обгортки: якщо sendInline / editInline не передали — не ламаємося
  const sendInlineSafe =
    typeof sendInline === "function"
      ? sendInline
      : async (env2, chatId2, text, replyMarkup) =>
          sendPlain(env2, chatId2, text, { reply_markup: replyMarkup });

  const editInlineSafe =
    typeof editInline === "function" ? editInline : async () => {};

  if (!cbData) return false;

  // Вмикання Codex-режиму з головною клавіатурою
  if (cbData === "codex:mode") {
    await sendInlineSafe(
      env,
      chatId,
      CODEX_MODE_INLINE.text,
      buildCodexKeyboard()
    );
    return true;
  }

  // Створення нового проєкту (стиль 2 — виділений блок)
  if (cbData === CB.NEW) {
    await sendPlain(
      env,
      chatId,
      [
        "🧠 Створюємо новий проєкт Senti Codex.",
        "",
        "Напиши його назву (1–3 слова).",
        "Це буде окрема Codex-папка з файлами idea.md, tasks.md і progress.md.",
      ].join("\n")
    );
    const kv = env.__KV || env.KV;
    if (kv) {
      await kv.put(UI_AWAIT_KEY(userId), "proj_name");
    }
    return true;
  }

  // Обрати проєкт – показати список
  if (cbData === CB.USE) {
    const all = await listProjects(env, userId);
    if (!all.length) {
      await sendPlain(
        env,
        chatId,
        "У тебе ще немає проєктів. Натисни «Створити проєкт»."
      );
      return true;
    }

    const rows = all.map((name) => [
      {
        text: `📌 ${name}`,
        callback_data: `${CB_USE_PREFIX}${name}`,
      },
      {
        text: "🗑",
        callback_data: `${CB_DELETE_PREFIX}${name}`,
      },
    ]);

    await sendInlineSafe(env, chatId, "Обери проєкт:", {
      inline_keyboard: rows,
    });
    return true;
  }

  // Вибір конкретного проєкту зі списку
  if (cbData.startsWith(CB_USE_PREFIX)) {
    const name = cbData.slice(CB_USE_PREFIX.length);
    const meta = await readMeta(env, userId, name);
    if (!meta) {
      await sendPlain(
        env,
        chatId,
        `Проєкт "${name}" не знайдено. Онови список або створи новий.`
      );
      return true;
    }
    await setCurrentProject(env, userId, name);

    // Після вибору проєкту — повертаємо головну клавіатуру Codex
    await sendInlineSafe(
      env,
      chatId,
      `✅ Активний проєкт: "${name}".`,
      buildCodexKeyboard()
    );
    return true;
  }

  // Видалення проєкту
  if (cbData.startsWith(CB_DELETE_PREFIX)) {
    const name = cbData.slice(CB_DELETE_PREFIX.length);
    const meta = await readMeta(env, userId, name);
    if (!meta) {
      await sendPlain(env, chatId, `Проєкт "${name}" вже видалено.`);
      return true;
    }
    await deleteProject(env, userId, name);
    await sendPlain(env, chatId, `🗑 Проєкт "${name}" видалено.`);
    return true;
  }

  // Показати idea.md
  if (cbData === CB.IDEA) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(
        env,
        chatId,
        "Спочатку активуй проєкт (кнопка «Обрати проєкт»)."
      );
      return true;
    }
    const ideaMd =
      (await readSection(env, userId, cur, "idea.md")) || "(ще немає ідеї)";
    await sendPlain(
      env,
      chatId,
      `Ідея проєкту "${cur}":\n\n${ideaMd.slice(0, 4000)}`
    );
    return true;
  }

  // Snapshot → додаємо зріз у progress.md
  if (cbData === CB.SNAPSHOT) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(
        env,
        chatId,
        "Спочатку активуй проєкт (кнопка «Обрати проєкт»)."
      );
      return true;
    }
    await sendPlain(
      env,
      chatId,
      "Зараз зберу snapshot проєкту (idea, tasks, progress) і додам у progress.md…"
    );
    const [ideaMd, tasksMd, progressMd] = await Promise.all([
      readSection(env, userId, cur, "idea.md"),
      readSection(env, userId, cur, "tasks.md"),
      readSection(env, userId, cur, "progress.md"),
    ]);
    const snapshotParts = [];
    snapshotParts.push("=== SNAPSHOT ІДЕЇ ===");
    snapshotParts.push(ideaMd || "(ще немає ідеї)");
    snapshotParts.push("=== SNAPSHOT TASKS ===");
    snapshotParts.push(tasksMd || "(ще немає задач)");
    snapshotParts.push("=== SNAPSHOT PROGRESS ===");
    snapshotParts.push(progressMd || "(ще немає історії)");
    const snapshot = snapshotParts.join("\n\n");
    await appendSection(
      env,
      userId,
      cur,
      "progress.md",
      `\n\n=== SNAPSHOT ===\n\n${snapshot}\n`
    );
    await sendPlain(env, chatId, "✅ Snapshot додано в progress.md.");
    return true;
  }

  // “Файли” — останні згадки про додані файли з progress.md
  if (cbData === CB.FILES) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(
        env,
        chatId,
        "Спочатку активуй проєкт (кнопка «Обрати проєкт»)."
      );
      return true;
    }
    const progressMd =
      (await readSection(env, userId, cur, "progress.md")) || "";
    const fileLines = progressMd
      .split("\n")
      .filter((l) => /додано файл:/i.test(l));
    if (!fileLines.length) {
      await sendPlain(
        env,
        chatId,
        "Ще немає збережених файлів для цього проєкту."
      );
      return true;
    }
    await sendPlain(
      env,
      chatId,
      `Файли проєкту "${cur}":\n\n${fileLines
        .slice(-20)
        .join("\n")
        .slice(0, 4000)}`
    );
    return true;
  }

  // Статус проєкту: короткий дайджест
  if (cbData === CB.STATUS) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(
        env,
        chatId,
        "Спочатку активуй проєкт (кнопка «Обрати проєкт»)."
      );
      return true;
    }

    const [ideaMd, tasksMd, progressMd] = await Promise.all([
      readSection(env, userId, cur, "idea.md"),
      readSection(env, userId, cur, "tasks.md"),
      readSection(env, userId, cur, "progress.md"),
    ]);

    const tasksLines = (tasksMd || "")
      .split("\n")
      .filter((x) => x.trim().startsWith("-"))
      .slice(0, 10);

    const progressLines = (progressMd || "")
      .split("\n")
      .filter((x) => x.trim().startsWith("-"))
      .slice(0, 10);

    const summary = [
      `📊 Статус проєкту "${cur}":`,
      "",
      "=== Коротка ідея ===",
      (ideaMd || "(ще немає ідеї)").slice(0, 400),
      "",
      "=== Задачі (до 10) ===",
      tasksLines.length ? tasksLines.join("\n") : "(ще немає задач)",
      "",
      "=== Останні кроки (до 10) ===",
      progressLines.length ? progressLines.join("\n") : "(ще немає прогресу)",
    ].join("\n");

    await sendPlain(env, chatId, summary);
    return true;
  }

  return false;
}

// -------------------- /project-команди --------------------
export async function handleCodexCommand(env, ctx, helpers = {}) {
  const { chatId, userId, textRaw } = ctx;
  const { sendPlain } = helpers;
  const kv = env.__KV || env.KV;

  const text = textRaw || "";

  if (!/^\/project\b/i.test(text)) return false;

  // /project help
  if (/^\/project\s+help\b/i.test(text)) {
    await sendPlain(
      env,
      chatId,
      [
        "Команди Codex /project:",
        "",
        "/project help — ця довідка",
        "/project new — створити новий проєкт",
        "/project use — текстовий список проєктів",
        "/project idea — показати idea.md",
        "/project snapshot — додати snapshot (idea/tasks/progress) у progress.md",
        "/project files — показати недавні файли (з progress.md)",
        "/project sync <section> — синхронізувати секцію в Google Drive (repo)",
      ].join("\n")
    );
    return true;
  }

  // /project new — та ж стилізація, що і в CB.NEW
  if (/^\/project\s+new\b/i.test(text)) {
    await sendPlain(
      env,
      chatId,
      [
        "🧠 Створюємо новий проєкт Senti Codex.",
        "",
        "Напиши його назву (1–3 слова).",
        "Це буде окрема Codex-папка з файлами idea.md, tasks.md і progress.md.",
      ].join("\n")
    );
    if (kv) await kv.put(UI_AWAIT_KEY(userId), "proj_name");
    return true;
  }

  // /project use — просто список назв (без клавіатури)
  if (/^\/project\s+use\b/i.test(text)) {
    const all = await listProjects(env, userId);
    if (!all.length) {
      await sendPlain(
        env,
        chatId,
        "У тебе ще немає проєктів. Натисни «Створити проєкт» у Codex."
      );
      return true;
    }
    const names = all.map((n) => `- ${n}`).join("\n");
    await sendPlain(env, chatId, `Доступні проєкти:\n${names}`);
    return true;
  }

  // /project idea
  if (/^\/project\s+idea\b/i.test(text)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur)
      return await sendPlain(
        env,
        chatId,
        "Спочатку активуй проєкт (кнопка «Обрати проєкт»)."
      );
    const ideaMd =
      (await readSection(env, userId, cur, "idea.md")) || "(ще немає ідеї)";
    await sendPlain(
      env,
      chatId,
      `Ідея проєкту "${cur}":\n\n${ideaMd.slice(0, 4000)}`
    );
    return true;
  }

  // /project snapshot
  if (/^\/project\s+snapshot\b/i.test(text)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur)
      return await sendPlain(
        env,
        chatId,
        "Спочатку активуй проєкт (кнопка «Обрати проєкт»)."
      );
    await sendPlain(env, chatId, "Збираю snapshot…");

    const [ideaMd, tasksMd, progressMd] = await Promise.all([
      readSection(env, userId, cur, "idea.md"),
      readSection(env, userId, cur, "tasks.md"),
      readSection(env, userId, cur, "progress.md"),
    ]);

    const snapshot =
      `=== SNAPSHOT ІДЕЇ ===\n${ideaMd || "(ще немає ідеї)"}\n\n` +
      `=== SNAPSHOT TASKS ===\n${tasksMd || "(ще немає задач)"}\n\n` +
      `=== SNAPSHOT PROGRESS ===\n${progressMd || "(ще немає історії)"}`;

    await appendSection(
      env,
      userId,
      cur,
      "progress.md",
      `\n\n=== SNAPSHOT ===\n${snapshot}\n`
    );

    await sendPlain(env, chatId, "Готово.");
    return true;
  }

  // /project files
  if (/^\/project\s+files\b/i.test(text)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur)
      return await sendPlain(
        env,
        chatId,
        "Спочатку активуй проєкт (кнопка «Обрати проєкт»)."
      );

    const progressMd =
      (await readSection(env, userId, cur, "progress.md")) || "";
    const fileLines = progressMd
      .split("\n")
      .filter((l) => /додано файл:/i.test(l));

    if (!fileLines.length) {
      await sendPlain(env, chatId, "Ще немає файлів.");
      return true;
    }

    await sendPlain(env, chatId, fileLines.slice(-20).join("\n"));
    return true;
  }

  // /project sync <section> → Google Drive repo
  if (/^\/project\s+sync\b/i.test(text)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur)
      return await sendPlain(
        env,
        chatId,
        "Спочатку активуй проєкт (кнопка «Обрати проєкт»)."
      );

    const section = text.replace(/^\/project\s+sync\b\s*/i, "").trim();
    if (!section) {
      await sendPlain(
        env,
        chatId,
        "Вкажи секцію: /project sync idea.md або tasks.md або progress.md."
      );
      return true;
    }

    const body =
      (await readSection(env, userId, cur, section)) ||
      "(секція ще порожня)";
    await sendPlain(env, chatId, `Синхронізую ${section}…`);
    await codexSyncSection(env, userId, cur, section, body);

    await sendPlain(env, chatId, `Готово: ${section} синхронізовано в Drive.`);
    return true;
  }

  return false;
}