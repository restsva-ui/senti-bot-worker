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
    "🧠 Senti Codex увімкнено. Натисни «Створити проєкт» — і я увімкну режим проєкту: збиратиму ідеї, посилання, все збережу в idea.md та assets. Або обери існуючий проєкт.",
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

  const sendInlineSafe =
    typeof sendInline === "function"
      ? sendInline
      : async (env2, chatId2, text, replyMarkup) =>
          sendPlain(env2, chatId2, text, { reply_markup: replyMarkup });

  const editInlineSafe =
    typeof editInline === "function" ? editInline : async () => {};

  if (!cbData) return false;

  if (cbData === "codex:mode") {
    await sendInlineSafe(
      env,
      chatId,
      CODEX_MODE_INLINE.text,
      buildCodexKeyboard()
    );
    return true;
  }

  if (cbData === CB.NEW) {
    await sendPlain(
      env,
      chatId,
      "Введи назву нового проєкту (коротко, 1–3 слова):"
    );
    const kv = env.__KV || env.KV;
    if (kv) {
      await kv.put(UI_AWAIT_KEY(userId), "proj_name");
    }
    return true;
  }

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
    await sendPlain(env, chatId, `✅ Активний проєкт: "${name}".`);
    return true;
  }

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

  if (cbData === CB.IDEA) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(
        env,
        chatId,
        "Спочатку обери активний проєкт (кнопка «Обрати проєкт»)."
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

  if (cbData === CB.SNAPSHOT) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(
        env,
        chatId,
        "Спочатку обери активний проєкт (кнопка «Обрати проєкт»)."
      );
      return true;
    }

    await sendPlain(
      env,
      chatId,
      "Готую snapshot у Google Drive (SentiCodex)…"
    );
    try {
      await codexSyncSection(env, userId, cur, "idea.md");
      await codexSyncSection(env, userId, cur, "tasks.md");
      await codexSyncSection(env, userId, cur, "progress.md");
      await sendPlain(
        env,
        chatId,
        "✅ Snapshot проєкту оновлено в Google Drive (SentiCodex)."
      );
    } catch (e) {
      await sendPlain(
        env,
        chatId,
        `❌ Не вдалося оновити snapshot: ${String(e?.message || e).slice(
          0,
          180
        )}`
      );
    }
    return true;
  }

  if (cbData === CB.FILES) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(
        env,
        chatId,
        "Спочатку обери активний проєкт (кнопка «Обрати проєкт»)."
      );
      return true;
    }

    const tasksMd =
      (await readSection(env, userId, cur, "tasks.md")) || "(ще немає tasks)";
    const progressMd =
      (await readSection(env, userId, cur, "progress.md")) ||
      "(ще немає progress)";
    const ideaMd =
      (await readSection(env, userId, cur, "idea.md")) || "(ще немає ідеї)";

    const summary = [
      `📁 Проєкт: "${cur}"`,
      "",
      "=== idea.md ===",
      ideaMd.slice(0, 2000),
      "",
      "=== tasks.md ===",
      tasksMd.slice(0, 2000),
      "",
      "=== progress.md ===",
      progressMd.slice(0, 2000),
    ].join("\n");

    await sendPlain(env, chatId, summary);
    return true;
  }

  if (cbData === CB.STATUS) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(
        env,
        chatId,
        "Спочатку обери активний проєкт (кнопка «Обрати проєкт»)."
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

// -------------------- /project-команди (текст) --------------------
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
        "/project help — довідка",
        "/project status — короткий статус активного проєкту",
        "/project idea — показати idea.md",
        "/project snapshot — оновити snapshot у Google Drive",
        "/project files — текстовий dump секцій (idea/tasks/progress)",
      ].join("\n")
    );
    return true;
  }

  // /project status
  if (/^\/project\s+status\b/i.test(text)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(
        env,
        chatId,
        "Спочатку обери активний проєкт (кнопка «Обрати проєкт»)."
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

  // /project idea
  if (/^\/project\s+idea\b/i.test(text)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(
        env,
        chatId,
        "Спочатку обери активний проєкт (кнопка «Обрати проєкт»)."
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

  // /project sync <section>
  if (/^\/project\s+sync\b/i.test(text)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(
        env,
        chatId,
        "Спочатку обери активний проєкт (кнопка «Обрати проєкт»)."
      );
      return true;
    }

    const parts = text.split(/\s+/);
    const section = parts[2];
    if (!section || !["idea.md", "tasks.md", "progress.md"].includes(section)) {
      await sendPlain(
        env,
        chatId,
        "Вкажи секцію: /project sync idea.md або tasks.md або progress.md."
      );
      return true;
    }

    await sendPlain(env, chatId, `Синхронізую ${section}…`);
    await codexSyncSection(env, userId, cur, section);

    await sendPlain(env, chatId, `Готово: ${section} синхронізовано.`);
    return true;
  }

  return false;
}