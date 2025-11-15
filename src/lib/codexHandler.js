/* Senti Codex 3.0 — AI Architect */

import { askAnyModel, askVision } from "./modelRouter.js";
import {
  codexUploadAssetFromUrl,
  codexExportSnapshot,
  codexSyncSection,
} from "./codexDrive.js";

// -------------------- ключі KV --------------------
export const CODEX_MEM_KEY = (uid) => `codex:mem:${uid}`;

const PROJ_CURR_KEY = (uid) => `codex:project:current:${uid}`;
const PROJ_META_KEY = (uid, name) => `codex:project:meta:${uid}:${name}`;
const PROJ_FILE_KEY = (uid, name, file) =>
  `codex:project:file:${uid}:${name}:${file}`;
const PROJ_PREFIX_LIST = (uid) => `codex:project:meta:${uid}:`;
const PROJ_TASKSEQ_KEY = (uid, name) =>
  `codex:project:taskseq:${uid}:${name}`;
const CODEX_TMP_NAME_KEY = (uid) => `codex:ui:tmpname:${uid}`;
const IDEA_DRAFT_KEY = (uid) => `codex:ideaDraft:${uid}`;

// callback data (inline)
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

function normalizeProjectName(name) {
  if (!name) return "Без назви";
  let n = String(name).trim();
  n = n.replace(/^["']+|["']+$/g, ""); // лапки
  n = n.replace(/^[\[\(\{<«]+|[\]\)\}>»]+$/g, ""); // дужки/скоби
  n = n.replace(/\s+/g, " ");
  return n || "Без назви";
}

// -------------------- опис режиму Codex --------------------
const CODEX_MODE_INLINE = {
  text:
    "🧠 Senti Codex увімкнено. Натисни «Створити проєкт» — і я увімкну режим збору ідей: просто пиши текст і кидай фото/файли/посилання, все збережу в idea.md та assets. Або обери існуючий проєкт.",
};

const CODEX_UI_PREFIX = (uid) => `codex:ui:${uid}:`;
const CODEX_UI_MODE_KEY = (uid) => `${CODEX_UI_PREFIX(uid)}mode`; // codex|off
const UI_AWAIT_KEY = (uid) => `codex:ui:await:${uid}`; // none|proj_name|use_name|idea_text|idea_confirm

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

// -------------------- утиліти --------------------
function pickKV(env) {
  return (
    env.STATE_KV ||
    env.CHECKLIST_KV ||
    env.ENERGY_LOG_KV ||
    env.LEARN_QUEUE_KV ||
    env.TODO_KV ||
    env.DIALOG_KV
  );
}
function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractTextFromModel(res) {
  if (!res) return "";
  if (typeof res === "string") return res;
  if (res.text) return res.text;
  if (
    res.choices &&
    res.choices[0] &&
    res.choices[0].message &&
    res.choices[0].message.content
  ) {
    return res.choices[0].message.content;
  }
  return JSON.stringify(res);
}

// -------------------- робота з KV --------------------
export const CODEX_MEM_KEY_CONST = CODEX_MEM_KEY;

export async function setCodexMode(env, userId, on) {
  const kv = pickKV(env);
  if (!kv) return;
  await kv.put(CODEX_UI_MODE_KEY(userId), on ? "codex" : "off", {
    expirationTtl: 60 * 60 * 24 * 365,
  });
}

export async function getCodexMode(env, userId) {
  const kv = pickKV(env);
  if (!kv) return "off";
  return (await kv.get(CODEX_UI_MODE_KEY(userId), "text")) || "off";
}

export async function clearCodexMem(env, userId) {
  const kv = pickKV(env);
  if (!kv) return;
  await kv.delete(CODEX_MEM_KEY(userId));
}

// -------------------- проєкти в KV --------------------
async function createProject(env, userId, name, ideaText = "") {
  const kv = pickKV(env);
  if (!kv) return;
  const normalized = normalizeProjectName(name);
  const meta = {
    name: normalized,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await kv.put(PROJ_META_KEY(userId, normalized), JSON.stringify(meta), {
    expirationTtl: 60 * 60 * 24 * 365,
  });
  if (ideaText) {
    await kv.put(PROJ_FILE_KEY(userId, normalized, "idea.md"), ideaText, {
      expirationTtl: 60 * 60 * 24 * 365,
    });
  }
  await setCurrentProject(env, userId, normalized);
}

async function readMeta(env, userId, name) {
  const kv = pickKV(env);
  if (!kv) return null;
  const normalized = normalizeProjectName(name);
  const raw = await kv.get(PROJ_META_KEY(userId, normalized), "text");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function listProjects(env, userId) {
  const kv = pickKV(env);
  if (!kv || !kv.list) return [];
  const out = [];
  let cursor;
  do {
    const res = await kv.list({ prefix: PROJ_PREFIX_LIST(userId), cursor });
    for (const k of res.keys || []) {
      const parts = k.name.split(":");
      const name = parts.slice(-1)[0];
      if (name && !out.includes(name)) out.push(name);
    }
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  return out;
}

async function deleteProject(env, userId, name) {
  const kv = pickKV(env);
  if (!kv || !kv.list) return;
  const normalized = normalizeProjectName(name);

  await kv.delete(PROJ_META_KEY(userId, normalized));

  const prefix = `codex:project:file:${userId}:${normalized}:`;
  let cursor;
  do {
    const res = await kv.list({ prefix, cursor });
    for (const k of res.keys || []) {
      await kv.delete(k.name);
    }
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);

  const cur = await kv.get(PROJ_CURR_KEY(userId), "text");
  if (cur && normalizeProjectName(cur) === normalized) {
    await kv.delete(PROJ_CURR_KEY(userId));
  }
}

async function writeSection(env, userId, name, file, content) {
  const kv = pickKV(env);
  if (!kv) return;
  await kv.put(PROJ_FILE_KEY(userId, name, file), content, {
    expirationTtl: 60 * 60 * 24 * 365,
  });
}

async function readSection(env, userId, name, file) {
  const kv = pickKV(env);
  if (!kv) return null;
  return await kv.get(PROJ_FILE_KEY(userId, name, file), "text");
}

async function appendSection(env, userId, name, file, line) {
  const prev = (await readSection(env, userId, name, file)) || "";
  const next = prev
    ? prev.endsWith("\n")
      ? prev + line
      : prev + "\n" + line
    : line;
  await writeSection(env, userId, name, file, next);
}

async function nextTaskSeq(env, userId, name) {
  const kv = pickKV(env);
  if (!kv) return 1;
  const key = PROJ_TASKSEQ_KEY(userId, name);
  const raw = (await kv.get(key, "text")) || "0";
  const n = Number.parseInt(raw, 10) || 0;
  const next = n + 1;
  await kv.put(key, String(next), {
    expirationTtl: 60 * 60 * 24 * 365,
  });
  return next;
}

async function setCurrentProject(env, userId, name) {
  const kv = pickKV(env);
  if (!kv) return;
  await kv.put(PROJ_CURR_KEY(userId), name, {
    expirationTtl: 60 * 60 * 24 * 365,
  });
}

async function getCurrentProject(env, userId) {
  const kv = pickKV(env);
  if (!kv) return null;
  return await kv.get(PROJ_CURR_KEY(userId), "text");
}
// -------------------- Codex UI (inline) --------------------
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
        ],
        [
          {
            text: "🗑 Видалити проєкт",
            callback_data: CB_DELETE_PREFIX + encodeURIComponent(name),
          },
        ],
      ],
    };

    await sendPlain(env, chatId, `✅ Активний проєкт: <b>${nice}</b>`, {
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
        `Опиши ідею для проєкту <b>${nice}</b>.`,
        "",
        "Напиши вільним текстом, що ти хочеш отримати.",
        "Я як Senti Codex Architect поставлю уточнюючі питання, сформую структурований опис і попрошу підтвердження перед збереженням.",
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
      .filter((l) => l.trim())
      .slice(-8)
      .join("\n")
      .slice(0, 1200);

    const body = [
      `📁 Проєкт: <b>${nice}</b>`,
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
    await sendPlain(env, chatId, `🗑 Проєкт <b>${nice}</b> видалено.`);
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
      `📁 Проєкт: <b>${nice}</b>`,
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
    await setCodexMode(env, userId, true);
    await sendPlain(env, chatId, CODEX_MODE_INLINE.text, {
      reply_markup: buildCodexKeyboard(),
    });
    return true;
  }

  if (text === "/codex_off") {
    await setCodexMode(env, userId, false);
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
      `✅ Створено проєкт "<b>${name}</b>". Опиши ідею (я збережу її в idea.md).`
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
      `✅ Активний проєкт: <b>${meta.name || name}</b>.`
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
      `📁 Проєкт: <b>${nice}</b>`,
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
// -------------------- Codex core generation --------------------
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
      `✅ Створено проєкт "<b>${name}</b>". Опиши ідею (я збережу її в idea.md).`
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
      "Твоє завдання — допомогти юзеру сформувати чітку, структурувану ідею проєкту.",
      "Сконструюй опис так, щоб його можна було використовувати як основу для архітектури та постановки задач.",
      "",
      "Вимоги до результату:",
      "- пиши українською;",
      "- використовуй підзаголовки (Мета, Ключові можливості, Обмеження, Технології, Наступні кроки);",
      "- не вигадуй неможливих речей, опирайся на текст користувача;",
      "- якщо чогось не вистачає — зроби розумні припущення, але познач їх як «припущення»."
    ].join("\n");

    const prompt = [
      `Проєкт: ${projName}`,
      "",
      "Попередній опис (може бути порожнім):",
      prevIdea ? `\"\"\"\\n${prevIdea.slice(0, 1500)}\\n\"\"\"` : "(ще не було ідеї)",
      "",
      "Новий опис ідеї від користувача:",
      `\"\"\"\\n${ideaRaw.slice(0, 2000)}\\n\"\"\"`,
      "",
      "Сформуй одну узгоджену, структуровану чернетку ідеї."
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

    const draft = extractTextFromModel(res).trim() || ideaRaw;

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
      `🧠 Чернетка ідеї для проєкту <b>${projName}</b>:`,
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

    const answer = textRaw.trim().toLowerCase();
    if (/^(\+|ок|добре|так|зберегти|save|ok)\b/.test(answer)) {
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
      "Онови чернетку ідеї з урахуванням коментарів користувача.",
      "",
      "Вимоги:",
      "- зберігай структуру (Мета, Ключові можливості, Обмеження, Технології, Наступні кроки);",
      "- не викидай важливі деталі з попередньої версії без причини;",
      "- чітко врахуй побажання користувача."
    ].join("\n");

    const prompt2 = [
      `Проєкт: ${projName}`,
      "",
      "Попередня чернетка:",
      `\"\"\"\\n${prevDraft.slice(0, 3000)}\\n\"\"\"`,
      "",
      "Коментарі / правки від користувача:",
      `\"\"\"\\n${note.slice(0, 2000)}\\n\"\"\"`,
      "",
      "Поверни оновлену чернетку ідеї.",
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

    const newDraft = extractTextFromModel(res2).trim() || prevDraft;

    const newObj = {
      ...draftObj,
      ideaDraft: newDraft,
      updatedAt: nowIso(),
    };
    await kv.put(IDEA_DRAFT_KEY(userId), JSON.stringify(newObj), {
      expirationTtl: 3600,
    });

    const respLines = [
      `🧠 Оновлена чернетка ідеї для <b>${projName}</b>:`,
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
    await sendPlain(env, chatId, `✅ Активний проєкт: <b>${name}</b>.`);
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

  // Fallback: якщо ідея ще не задана, а Codex не в стані idea_text,
  // трактуємо перший текст як опис ідеї та запускаємо Architect-діалог.
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
      "Твоє завдання — допомогти юзеру сформувати чітку, структурувану ідею проєкту.",
      "",
      "Вимоги до результату:",
      "- пиши українською;",
      "- використовуй підзаголовки (Мета, Ключові можливості, Обмеження, Технології, Наступні кроки);",
      "- не вигадуй неможливих речей, опирайся на текст користувача;",
      "- якщо чогось не вистачає — зроби розумні припущення, але познач їх як «припущення»."
    ].join("\n");

    const prompt = [
      `Проєкт: ${projName}`,
      "",
      "Попередній опис (може бути порожнім):",
      prevIdea ? `\"\"\"\\n${prevIdea.slice(0, 1500)}\\n\"\"\"` : "(ще не було ідеї)",
      "",
      "Новий опис ідеї від користувача:",
      `\"\"\"\\n${ideaRaw.slice(0, 2000)}\\n\"\"\"`,
      "",
      "Сформуй одну узгоджену, структуровану чернетку ідеї."
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

    const draft = extractTextFromModel(res).trim() || ideaRaw;

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
      `🧠 Чернетка ідеї для проєкту <b>${projName}</b>:`,
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
    "Ти — Senti Codex 3.0 (AI Architect).",
    "Ти поєднуєш ролі: архітектор, senior-розробник і аналітик вимог.",
    "Працюєш у режимі проєкту; зберігай цілісну картину й будуй відповідь так, щоб нею можна було керувати розробкою.",
    "",
    "Коли немає чіткого запиту на конкретний код — спершу дай архітектуру, структуру файлів/модулів, список задач і план кроків.",
    "Коли бачиш фрагменти коду — спочатку короткий огляд, потім пропонуй зміни (diff/рефакторинг), і лише після цього приклади коду.",
    "Для зображень та assets пояснюй, як саме їх краще використати в проєкті (логотип, банер, UI, іконки, контент).",
    "Не вигадуй вміст зовнішніх посилань: якщо ти його не бачиш у тексті — стався до нього як до невідомого ресурсу й кажи про це прямо.",
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
      "Немає явного текстового запиту. Зроби огляд поточного стану проєкту та запропонуй наступні кроки."
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

  const outText =
    typeof res === "string"
      ? res
      : res?.choices?.[0]?.message?.content ||
        res?.text ||
        JSON.stringify(res);

  const proj = await readMeta(env, userId, curName);
  if (proj && proj.name) {
    await appendSection(
      env,
      userId,
      proj.name,
      "progress.md",
      `- ${nowIso()} — Відповідь Codex: ${(outText || "").slice(0, 120)}…`
    );
  }
  await sendPlain(env, chatId, outText || "Не впевнений.");
}