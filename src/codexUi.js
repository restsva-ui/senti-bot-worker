// src/codexUi.js
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
} from "./codexState.js";

import {
  pickKV,
  nowIso,
} from "./codexUtils.js";

import {
  codexExportSnapshot,
  codexSyncSection,
} from "./codexDrive.js";

// -------------------- опис режиму Codex --------------------
const CODEX_MODE_INLINE = {
  text:
    "🧠 Senti Codex увімкнено. Натисни «Створити проєкт» — і я увімкну режим збору ідей: просто пиши текст і кидай фото/файли/посилання, все збережу в idea.md та assets. Або обери існуючий проєкт.",
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
      [{ text: "➕ Створити проєкт", callback_data: CB.NEW }],
      [{ text: "📂 Обрати проєкт", callback_data: CB.USE }],
      [{ text: "📋 Статус", callback_data: CB.STATUS }],
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
  const kv = pickKV(env);
  if (!kv) return false;
  const { sendPlain } = helpers;

  if (cbData === CB.NEW) {
    await kv.put(UI_AWAIT_KEY(userId), "proj_name", { expirationTtl: 3600 });
    await sendPlain(env, chatId, "Введи назву нового проєкту:", {
      reply_markup: {
        force_reply: true,
        input_field_placeholder: "Назва проєкту",
      },
    });
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

    const rows = all.map((name) => {
      const nice = normalizeProjectName(name);
      return [
        {
          text: `📁 ${nice}`,
          callback_data: CB_USE_PREFIX + encodeURIComponent(name),
        },
      ];
    });

    await sendPlain(env, chatId, "Обери проєкт:", {
      reply_markup: { inline_keyboard: rows },
    });
    return true;
  }

  if (cbData === CB.LIST) {
    const all = await listProjects(env, userId);
    if (!all.length) {
      await sendPlain(env, chatId, "Поки немає жодного проєкту.");
      return true;
    }
    const body =
      "Проєкти:\n" +
      all
        .map((name, idx) => {
          const nice = normalizeProjectName(name);
          return `${idx + 1}. ${nice}`;
        })
        .join("\n");
    await sendPlain(env, chatId, body);
    return true;
  }

  if (cbData.startsWith(CB_USE_PREFIX)) {
    const raw = cbData.slice(CB_USE_PREFIX.length);
    let name = raw;
    try {
      name = decodeURIComponent(raw);
    } catch {
      // ignore
    }
    if (!name) {
      await sendPlain(env, chatId, "Не вдалося розпізнати назву проєкту.");
      return true;
    }
    await setCurrentProject(env, userId, name);
    const nice = normalizeProjectName(name);

    const perProjectKb = {
      inline_keyboard: [
        [
          { text: "📋 Статус", callback_data: CB.STATUS },
          { text: "✏️ Ідея", callback_data: CB.IDEA },
        ],
        [
          { text: "📦 Snapshot", callback_data: CB.SNAPSHOT },
          { text: "🗄 Файли", callback_data: CB.FILES },
          {
            text: "🗑",
            callback_data: CB_DELETE_PREFIX + encodeURIComponent(name),
          },
        ],
      ],
    };

    await sendPlain(env, chatId, `✅ Активний проєкт: *${nice}*`, {
      reply_markup: perProjectKb,
    });
    return true;
  }

  if (cbData === CB.IDEA) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Спочатку обери або створи проєкт.");
      return true;
    }
    const nice = normalizeProjectName(cur);
    await kv.put(UI_AWAIT_KEY(userId), "idea_text", { expirationTtl: 3600 });
    await sendPlain(
      env,
      chatId,
      [
        `Опиши ідею для проєкту *${nice}*.`,
        "",
        "Напиши вільним текстом, що ти хочеш отримати.",
        "Я як Senti Codex Architect поставлю уточнюючі питання, сформую короткий структурований опис (до 1 екрана) і попрошу підтвердження перед збереженням.",
      ].join("\n")
    );
    return true;
  }

  if (cbData === CB.SNAPSHOT) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Спочатку активуй проєкт.");
      return true;
    }
    await sendPlain(env, chatId, "Готую snapshot проєкту…");
    const res = await codexExportSnapshot(env, userId, cur);
    if (!res || !res.ok) {
      await sendPlain(env, chatId, "Не вдалось зробити snapshot.");
      return true;
    }
    const { url } = res;
    await sendPlain(env, chatId, `Snapshot готовий:\n${url}`);
    return true;
  }

  if (cbData === CB.FILES) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Спочатку активуй проєкт.");
      return true;
    }
    const nice = normalizeProjectName(cur);
    const idea = (await readSection(env, userId, cur, "idea.md")) || "";
    const tasks = (await readSection(env, userId, cur, "tasks.md")) || "";
    const progress =
      (await readSection(env, userId, cur, "progress.md")) || "";

    const ideaShort = (idea || "")
      .split("\n")
      .filter((l) => l.trim())
      .slice(0, 12)
      .join("\n")
      .slice(0, 1200);

    const tasksShort = (tasks || "")
      .split("\n")
      .filter((l) => l.trim())
      .slice(0, 12)
      .join("\n")
      .slice(0, 1200);

    const progressShort = (progress || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-8)
      .join("\n")
      .slice(0, 1200);

    const body = [
      `📁 Проєкт: *${nice}*`,
      "",
      "🧠 Ідея (уривок):",
      ideaShort || "— (ще немає опису ідеї)",
      "",
      "✅ Tasks (уривок):",
      tasksShort || "— (ще немає задач)",
      "",
      "📈 Останній прогрес:",
      progressShort || "— (ще не було записів прогресу)",
    ].join("\n");

    await sendPlain(env, chatId, body);
    return true;
  }

  if (cbData.startsWith(CB_DELETE_PREFIX)) {
    const raw = cbData.slice(CB_DELETE_PREFIX.length);
    let name = raw;
    try {
      name = decodeURIComponent(raw);
    } catch {
      // ignore
    }
    if (!name) {
      await sendPlain(
        env,
        chatId,
        "Не вдалося розпізнати назву для видалення."
      );
      return true;
    }
    const nice = normalizeProjectName(name);
    await deleteProject(env, userId, name);
    await sendPlain(env, chatId, `🗑 Проєкт *${nice}* видалено.`);
    return true;
  }

  if (cbData === CB.STATUS) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Спочатку активуй проєкт.");
      return true;
    }
    const nice = normalizeProjectName(cur);
    const idea = (await readSection(env, userId, cur, "idea.md")) || "";
    const tasks = (await readSection(env, userId, cur, "tasks.md")) || "";
    const progress =
      (await readSection(env, userId, cur, "progress.md")) || "";

    const ideaClean = (idea || "")
      .split("\n")
      .filter((line) => !/^LOCKED\s*:/i.test(line))
      .join("\n")
      .trim()
      .slice(0, 700);

    const progressLines = (progress || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-5);

    const taskLines = (tasks || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-6);

    const body = [
      `📁 Проєкт: *${nice}*`,
      "",
      "🧠 Ідея (уривок):",
      ideaClean || "— (ще немає опису ідеї)",
      "",
      "📈 Останній прогрес:",
      progressLines.join("\n") || "— (ще не було записів прогресу)",
      "",
      "✅ Tasks (останні рядки):",
      taskLines.join("\n") || "— (ще немає задач)",
    ].join("\n");

    await sendPlain(env, chatId, body);
    return true;
  }

  return false;
}

// -------------------- /project-команди --------------------
export async function handleCodexCommand(
  env,
  chatId,
  userId,
  textRaw,
  sendPlain
) {
  const text = (textRaw || "").trim();

  if (text === "/codex_on") {
    const kv = pickKV(env);
    if (kv) {
      await kv.put(UI_AWAIT_KEY(userId), "none", { expirationTtl: 3600 });
    }
    await sendPlain(env, chatId, CODEX_MODE_INLINE.text, {
      reply_markup: buildCodexKeyboard(),
    });
    return true;
  }

  if (text === "/codex_off") {
    const kv = pickKV(env);
    if (kv) {
      await kv.put(UI_AWAIT_KEY(userId), "none", { expirationTtl: 3600 });
    }
    await sendPlain(env, chatId, "Senti Codex вимкнено.");
    return true;
  }

  // /project new <name?>
  if (/^\/project\s+new\b/i.test(text)) {
    const name = text.replace(/^\/project\s+new\b\s*/i, "").trim();
    if (!name) {
      await sendPlain(
        env,
        chatId,
        "Вкажи назву: /project new MyApp або натисни «Створити проєкт»."
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
    const kv = pickKV(env);
    if (kv) {
      await kv.put(UI_AWAIT_KEY(userId), "idea_text", { expirationTtl: 3600 });
    }
    return true;
  }

  // /project list
  if (/^\/project\s+list\b/i.test(text)) {
    const all = await listProjects(env, userId);
    if (!all.length) {
      await sendPlain(env, chatId, "Поки немає жодного проєкту.");
      return true;
    }
    const body =
      "Проєкти:\n" +
      all
        .map((name, idx) => {
          const nice = normalizeProjectName(name);
          return `${idx + 1}. ${nice}`;
        })
        .join("\n");
    await sendPlain(env, chatId, body);
    return true;
  }

  // /project use <name>
  if (/^\/project\s+use\b/i.test(text)) {
    const name = text.replace(/^\/project\s+use\b\s*/i, "").trim();
    if (!name) {
      await sendPlain(env, chatId, "Вкажи назву: /project use MyApp.");
      return true;
    }
    const meta = await readMeta(env, userId, name);
    if (!meta) {
      await sendPlain(env, chatId, `Проєкт "${name}" не знайдено.`);
      return true;
    }
    await setCurrentProject(env, userId, meta.name || name);
    await sendPlain(
      env,
      chatId,
      `✅ Активний проєкт: *${meta.name || name}*.`
    );
    return true;
  }

  // /project status
  if (/^\/project\s+status\b/i.test(text)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Спочатку активуй проєкт.");
      return true;
    }
    const nice = normalizeProjectName(cur);
    const idea = (await readSection(env, userId, cur, "idea.md")) || "";
    const tasks = (await readSection(env, userId, cur, "tasks.md")) || "";
    const progress =
      (await readSection(env, userId, cur, "progress.md")) || "";

    const ideaClean = (idea || "")
      .split("\n")
      .filter((line) => !/^LOCKED\s*:/i.test(line))
      .join("\n")
      .trim()
      .slice(0, 700);

    const progressLines = (progress || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-5);

    const taskLines = (tasks || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-6);

    const body = [
      `📁 Проєкт: *${nice}*`,
      "",
      "🧠 Ідея (уривок):",
      ideaClean || "— (ще немає опису ідеї)",
      "",
      "📈 Останній прогрес:",
      progressLines.join("\n") || "— (ще не було записів прогресу)",
      "",
      "✅ Tasks (останні рядки):",
      taskLines.join("\n") || "— (ще немає задач)",
    ].join("\n");

    await sendPlain(env, chatId, body);
    return true;
  }

  // /project idea set / append
  if (/^\/project\s+idea\s+/i.test(text)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Спочатку активуй проєкт.");
      return true;
    }
    const isAppend = /append/i.test(text);
    const body = text.replace(/^\/project\s+idea\s+(set|append)\s*/i, "").trim();
    if (!body) {
      await sendPlain(env, chatId, "Вкажи текст ідеї після команди.");
      return true;
    }
    if (isAppend) {
      await appendSection(env, userId, cur, "idea.md", body);
    } else {
      await writeSection(env, userId, cur, "idea.md", body);
    }
    await sendPlain(env, chatId, "✅ Ідею оновлено в idea.md.");
    return true;
  }

  // /project task <text>
  if (/^\/project\s+task\b/i.test(text)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Спочатку активуй проєкт.");
      return true;
    }
    const body = text.replace(/^\/project\s+task\b\s*/i, "").trim();
    if (!body) {
      await sendPlain(env, chatId, "Вкажи текст задачі після /project task.");
      return true;
    }
    const seq = await nextTaskSeq(env, userId, cur);
    await appendSection(env, userId, cur, "tasks.md", `${seq}. ${body}`);
    await sendPlain(env, chatId, `✅ Додано задачу #${seq}.`);
    return true;
  }

  // /project progress <text>
  if (/^\/project\s+progress\b/i.test(text)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Спочатку активуй проєкт.");
      return true;
    }
    const body = text.replace(/^\/project\s+progress\b\s*/i, "").trim();
    if (!body) {
      await sendPlain(
        env,
        chatId,
        "Вкажи текст прогресу після /project progress."
      );
      return true;
    }
    await appendSection(
      env,
      userId,
      cur,
      "progress.md",
      `- ${nowIso()} — ${body}`
    );
    await sendPlain(env, chatId, "✅ Прогрес оновлено.");
    return true;
  }

  // /project snapshot
  if (/^\/project\s+snapshot\b/i.test(text)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Спочатку активуй проєкт.");
      return true;
    }
    await sendPlain(env, chatId, "Готую snapshot проєкту…");
    const res = await codexExportSnapshot(env, userId, cur);
    if (!res || !res.ok) {
      await sendPlain(env, chatId, "Не вдалось зробити snapshot.");
      return true;
    }
    const { url } = res;
    await sendPlain(env, chatId, `Snapshot готовий:\n${url}`);
    return true;
  }

  // /project sync <section>
  if (/^\/project\s+sync\b/i.test(text)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Спочатку активуй проєкт.");
      return true;
    }
    const section = text.replace(/^\/project\s+sync\b\s*/i, "").trim();
    if (!section) {
      await sendPlain(
        env,
        chatId,
        "Вкажи секцію: /project sync idea.md або tasks.md або progress.md."
      );
      return true;
    }
    await sendPlain(env, chatId, `Синхронізую секцію ${section}…`);
    const res = await codexSyncSection(env, userId, cur, section);
    if (!res || !res.ok) {
      await sendPlain(env, chatId, "Не вдалося синхронізувати.");
      return true;
    }
    await sendPlain(
      env,
      chatId,
      `✅ Секцію ${section} синхронізовано в Brain/Repo.`
    );
    return true;
  }

  return false;
}
