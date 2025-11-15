// src/lib/codexHandler.js
// Senti Codex: режим коду + "Project Mode" з простим UI (inline + force-reply)
// + інтеграція Google Drive (структура проєктів, assets, snapshot-експорт).
//
// Експорти: CODEX_MEM_KEY, setCodexMode, getCodexMode, clearCodexMem,
//          handleCodexCommand, handleCodexGeneration,
//          buildCodexKeyboard, handleCodexUi.

import { askAnyModel, askVision } from "./modelRouter.js";
import {
  codexSyncSection,
  codexBootstrapProject,
  codexExportSnapshot,
  codexUploadAssetFromUrl,
} from "./codexDrive.js";

// -------------------- ключі KV --------------------
const CODEX_MEM_KEY = (uid) => `codex:mem:${uid}`; // довготривала пам'ять

// Project Mode: активний проєкт юзера + метадані + секції (KV)
const PROJ_CURR_KEY = (uid) => `codex:project:current:${uid}`; // string
const PROJ_META_KEY = (uid, name) => `codex:project:meta:${uid}:${name}`; // json
const PROJ_FILE_KEY = (uid, name, file) =>
  `codex:project:file:${uid}:${name}:${file}`; // text/md/json
const PROJ_PREFIX_LIST = (uid) => `codex:project:meta:${uid}:`;
const PROJ_TASKSEQ_KEY = (uid, name) =>
  `codex:project:taskseq:${uid}:${name}`; // auto increment
const CODEX_TMP_NAME_KEY = (uid) => `codex:ui:tmpname:${uid}`; // тимчасова назва проєкту

// callback data (inline)
export const CB = {
  NEW: "codex:new",
  LIST: "codex:list",
  USE: "codex:use",
  STATUS: "codex:status",
};

const CB_USE_PREFIX = "codex:use:";
const CB_DELETE_PREFIX = "codex:del:";

function normalizeProjectName(name) {
  let n = String(name || "").trim();
  // прибираємо лапки, дужки, кутові скоби з початку/кінця
  n = n.replace(/^[\"'«<\[]+/, "").replace(/[\"'»>\]]+$/, "");
  if (!n) n = "Без назви";
  return n;
}

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

// -------------------- робота з KV --------------------
export const CODEX_MEM_KEY_CONST = CODEX_MEM_KEY;

export async function setCodexMode(env, userId, on) {
  const kv = pickKV(env);
  if (!kv) return;
  await kv.put(CODEX_MODE_KEY(userId), on ? "true" : "false", {
    expirationTtl: 60 * 60 * 24 * 365,
  });
}
const CODEX_MODE_KEY = (uid) => `codex:mode:${uid}`;

export async function getCodexMode(env, userId) {
  const kv = pickKV(env);
  if (!kv) return false;
  const v = await kv.get(CODEX_MODE_KEY(userId), "text");
  return v === "true";
}
export async function clearCodexMem(env, userId) {
  const kv = pickKV(env);
  if (!kv) return;
  await kv.delete(CODEX_MEM_KEY(userId));
}

// -------------------- Project Mode: CRUD у KV --------------------
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
async function saveMeta(env, userId, name, meta) {
  const kv = pickKV(env);
  if (!kv) return;
  await kv.put(PROJ_META_KEY(userId, name), JSON.stringify(meta), {
    expirationTtl: 60 * 60 * 24 * 365,
  });
}
async function readMeta(env, userId, name) {
  const kv = pickKV(env);
  if (!kv) return null;
  const raw = await kv.get(PROJ_META_KEY(userId, name), "text");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
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
async function listProjects(env, userId) {
  const kv = pickKV(env);
  if (!kv || !kv.list) return [];
  const out = [];
  let cursor = undefined;
  do {
    const res = await kv.list({ prefix: PROJ_PREFIX_LIST(userId), cursor });
    for (const k of res.keys || []) {
      const parts = k.name.split(":"); // codex:project:meta:<uid>:<name>
      const name = parts.slice(-1)[0];
      if (name && !out.includes(name)) out.push(name);
    }
    cursor = res.cursor || null;
  } while (cursor);
  return out.sort();
}

async function deleteProject(env, userId, name) {
  const kv = pickKV(env);
  if (!kv || !kv.list) return;
  const metaKey = PROJ_META_KEY(userId, name);
  try {
    await kv.delete(metaKey);
  } catch {}
  const prefix = `codex:project:file:${userId}:${name}:`;
  let cursor = undefined;
  do {
    const res = await kv.list({ prefix, cursor });
    for (const k of res.keys || []) {
      try {
        await kv.delete(k.name);
      } catch {}
    }
    cursor = res.cursor || null;
  } while (cursor);
  const cur = await kv.get(PROJ_CURR_KEY(userId), "text");
  if (cur === name) {
    try {
      await kv.delete(PROJ_CURR_KEY(userId));
    } catch {}
  }
}

async function nextTaskId(env, userId, name) {
  const kv = pickKV(env);
  if (!kv) return 1;
  const k = PROJ_TASKSEQ_KEY(userId, name);
  const curStr = await kv.get(k);
  const cur = Number(curStr || "0");
  const nxt = Number.isFinite(cur) ? cur + 1 : 1;
  await kv.put(k, String(nxt), { expirationTtl: 60 * 60 * 24 * 365 });
  return nxt;
}

// -------------------- шаблони --------------------
function templateReadme(name) {
  return `# ${name}
Senti Codex Project

- \`idea.md\` — контракт ідеї (Codex дотримується автоматично).
- \`spec.md\` — вимоги/архітектура.
- \`connectors.md\` — інтеграції/секрети/чеклісти.
- \`progress.md\` — журнал прогресу.
- \`tasks.md\` — TODO/DOING/DONE.
- \`decisions.md\` — ADR (журнал рішень).
- \`risks.md\` — ризики/пом'якшення.
- \`testplan.md\` — тести/приймання.
`;
}
function templateIdea(initialIdea = "") {
  return `## Ідея (контракт)
${initialIdea || "Опишіть бачення/цілі/обмеження. Це — джерело істини."}

## Anti-goals
- Що **не** робимо та чого уникаємо.

## Додаткові матеріали
- ...
`;
}function templateTasksTable() {
  return `# Tasks

| ID | State | Title |
|----|-------|-------|
`;
}
function templateProgress() {
  return `# Progress

- ${nowIso()} — Ініціалізація проєкту.
`;
}
function templateDecisions() {
  return `# Decisions (ADR)

- ${nowIso()} — Створено проєкт, затверджено базову ідею.
`;
}
function templateRisks() {
  return `# Risks

- ...
`;
}
function templateTestplan() {
  return `# Testplan

- ...
`;
}

// -------------------- ініціалізація проєкту --------------------
async function createProject(env, userId, name, initialIdea) {
  const meta = {
    name,
    createdAt: nowIso(),
    stage: "idea",
    locked: false,
  };
  await saveMeta(env, userId, name, meta);
  await setCurrentProject(env, userId, name);

  await writeSection(env, userId, name, "README.md", templateReadme(name));
  await writeSection(env, userId, name, "idea.md", templateIdea(initialIdea));
  await writeSection(env, userId, name, "tasks.md", templateTasksTable());
  await writeSection(env, userId, name, "progress.md", templateProgress());
  await writeSection(env, userId, name, "decisions.md", templateDecisions());
  await writeSection(env, userId, name, "risks.md", templateRisks());
  await writeSection(env, userId, name, "testplan.md", templateTestplan());
}

// -------------------- keyboard Codex --------------------
function buildCodexKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "➕ Створити проєкт", callback_data: CB.NEW }],
      [{ text: "📂 Обрати проєкт", callback_data: CB.USE }],
      [{ text: "📋 Статус", callback_data: CB.STATUS }],
    ],
  };
}
;

// -------------------- Codex UI (inline) --------------------
const CODEX_MODE_INLINE = {
  text: "Senti Codex увімкнено. Натисни «Створити проєкт» — і я увімкну режим збору ідеї: просто пиши текст і кидай фото/файли/посилання, все збережу в idea.md та assets. Або обери існуючий проєкт.",
};

const CODEX_UI_PREFIX = (uid) => `codex:ui:${uid}:`;
const CODEX_UI_MODE_KEY = (uid) => `${CODEX_UI_PREFIX(uid)}mode`; // codex|off
const UI_AWAIT_KEY = (uid) => `codex:ui:await:${uid}`; // none|proj_name|use_name|idea

// -------------------- handleCodexUi --------------------
/**
 * handleCodexUi: обробляє callback_data з inline-меню Codex.
 */
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
        "Немає проєктів. Спочатку створи /project new <name>."
      );
      return true;
    }
    const buttons = all.slice(0, 25).map((name) => {
      const pretty = normalizeProjectName(name);
      const encoded = encodeURIComponent(name).slice(0, 50);
      return [
        { text: `📁 ${pretty}`, callback_data: CB_USE_PREFIX + encoded },
        { text: "🗑", callback_data: CB_DELETE_PREFIX + encoded },
      ];
    });
    await sendPlain(env, chatId, "Оберіть проєкт:", {
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
    return true;
  }

  if (cbData === CB.LIST) {
    const all = await listProjects(env, userId);
    const cur = await getCurrentProject(env, userId);
    if (!all.length) {
      await sendPlain(
        env,
        chatId,
        "Немає проєктів. Створи: /project new <name>"
      );
      return true;
    }
    const body = all
      .map((n, i) => {
        const pretty = normalizeProjectName(n);
        const mark = n === cur ? " (active)" : "";
        return `${i + 1}. ${pretty}${mark}`;
      })
      .join("\n");
    await sendPlain(env, chatId, `Проєкти:\n${body}`);
    return true;
  }

  if (cbData.startsWith(CB_USE_PREFIX)) {
    const raw = cbData.slice(CB_USE_PREFIX.length);
    const name = decodeURIComponent(raw || "");
    if (!name) {
      await sendPlain(env, chatId, "Не вдалося розпізнати назву проєкту.");
      return true;
    }
    await setCurrentProject(env, userId, name);
    const nice = normalizeProjectName(name);
    await sendPlain(env, chatId, `Активний проєкт: ${nice}`);
    return true;
  }

  if (cbData.startsWith(CB_DELETE_PREFIX)) {
    const raw = cbData.slice(CB_DELETE_PREFIX.length);
    const name = decodeURIComponent(raw || "");
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
    await sendPlain(env, chatId, `🗑 Проєкт видалено: ${nice}`);
    return true;
  }

  if (cbData === CB.STATUS) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Активуй або створи проєкт.");
      return true;
    }
    const idea = (await readSection(env, userId, cur, "idea.md")) || "";
    const progress =
      (await readSection(env, userId, cur, "progress.md")) || "";
    const tasks = (await readSection(env, userId, cur, "tasks.md")) || "";

    const nice = normalizeProjectName(cur);

    const ideaClean = (idea || "")
      .split("\n")
      .filter((line) => !/^LOCKED\\s*:/i.test(line))
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
      `📁 Проєкт: ${nice}`,
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

// ----------
export async function handleCodexCommand(env, chatId, userId, textRaw, sendPlain) {
  const text = (textRaw || "").trim();

  if (text === "/codex_off") {
    await setCodexMode(env, userId, false);
    await sendPlain(env, chatId, "Senti Codex вимкнено.");
    return true;
  }

  if (text === "/codex_on" || text === "/codex") {
    await setCodexMode(env, userId, true);
    await sendPlain(env, chatId, CODEX_MODE_INLINE.text, {
      reply_markup: buildCodexKeyboard(),
    });
    return true;
  }

  // /project new <name> [; idea: ...]
  if (/^\/project\s+new\s+/i.test(text)) {
    const m = text.match(/^\/project\s+new\s+(.+)$/i);
    if (!m) return false;
    const tail = m[1].trim();
    let name = tail;
    let idea = "";
    const semi = tail.split(";");
    if (semi.length > 1) {
      name = semi[0].trim();
      const ideaM = tail.match(/idea\s*:\s*(.+)$/i);
      idea = ideaM ? ideaM[1].trim() : "";
    }
    if (!name) {
      await sendPlain(env, chatId, "Вкажи назву: /project new <name>");
      return true;
    }

    await createProject(env, userId, name, idea);
    await sendPlain(
      env,
      chatId,
      `✅ Створено проєкт "${name}". Він активний.\n` +
        (idea
          ? "Ідея збережена в idea.md.\n"
          : "Додай ідею: /project idea set <текст>")
    );
    return true;
  }

  // /project use <name>
  if (/^\/project\s+use\s+/i.test(text)) {
    const m = text.match(/^\/project\s+use\s+(.+)$/i);
    if (!m) return false;
    const name = m[1].trim();
    if (!name) {
      await sendPlain(env, chatId, "Вкажи назву: /project use <name>");
      return true;
    }
    const meta = await readMeta(env, userId, name);
    if (!meta) {
      await sendPlain(env, chatId, `Проєкт "${name}" не знайдено.`);
      return true;
    }
    await setCurrentProject(env, userId, name);
    await sendPlain(env, chatId, `✅ Активний проєкт: "${name}".`);
    return true;
  }

  // /project list
  if (/^\/project\s+list/i.test(text)) {
    const all = await listProjects(env, userId);
    const cur = await getCurrentProject(env, userId);
    if (!all.length) {
      await sendPlain(
        env,
        chatId,
        "Немає проєктів. Створи: /project new <name>"
      );
      return true;
    }
    const body = all
      .map((n, i) => {
        const pretty = normalizeProjectName(n);
        const mark = n === cur ? " (active)" : "";
        return `${i + 1}. ${pretty}${mark}`;
      })
      .join("\n");
    await sendPlain(env, chatId, `Проєкти:\n${body}`);
    return true;
  }

  // /project idea set|append ...
  if (/^\/project\s+idea\s+/i.test(text)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Спочатку активуй проєкт.");
      return true;
    }
    const m = text.match(/^\/project\s+idea\s+(set|append)\s+([\s\S]+)$/i);
    if (!m) {
      await sendPlain(
        env,
        chatId,
        "Синтаксис: /project idea set <текст> або /project idea append <текст>"
      );
      return true;
    }
    const action = m[1].toLowerCase();
    const rest = m[2].trim();
    if (!rest) {
      await sendPlain(env, chatId, "Дай текст після команди.");
      return true;
    }
    if (action === "set") {
      await writeSection(
        env,
        userId,
        cur,
        "idea.md",
        `## Ідея (контракт)\n${rest.trim()}`
      );
      await sendPlain(env, chatId, "✅ Ідею оновлено (set).");
    } else {
      await appendSection(env, userId, cur, "idea.md", rest.trim());
      await sendPlain(env, chatId, "✅ Ідею доповнено (append).");
    }
    return true;
  }

  // /project tasks add|done <line>
  if (/^\/project\s+tasks\s+/i.test(text)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Спочатку активуй проєкт.");
      return true;
    }
    const m = text.match(/^\/project\s+tasks\s+(add|done)\s+([\s\S]+)$/i);
    if (!m) {
      await sendPlain(
        env,
        chatId,
        "Синтаксис: /project tasks add <рядок> або /project tasks done <рядок>"
      );
      return true;
    }
    const action = m[1].toLowerCase();
    const line = m[2].trim();
    if (!line) {
      await sendPlain(env, chatId, "Вкажи текст tasks.");
      return true;
    }
    const id = await nextTaskId(env, userId, cur);
    const prefix = action === "done" ? "[x]" : "[ ]";
    await appendSection(
      env,
      userId,
      cur,
      "tasks.md",
      `${id}\t${prefix}\t${line}`
    );
    await sendPlain(env, chatId, "✅ Tasks оновлено.");
    return true;
  }

  // /project progress <line>
  if (/^\/project\s+progress\s+/i.test(text)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Спочатку активуй проєкт.");
      return true;
    }
    const m = text.match(/^\/project\s+progress\s+([\s\S]+)$/i);
    if (!m) {
      await sendPlain(
        env,
        chatId,
        "Синтаксис: /project progress <рядок/абзац>"
      );
      return true;
    }
    const line = m[1].trim();
    if (!line) {
      await sendPlain(env, chatId, "Додай текст до progress.");
      return true;
    }
    await appendSection(env, userId, cur, "progress.md", line);
    await sendPlain(env, chatId, "✅ Progress оновлено.");
    return true;
  }

  // /project snapshot
  if (/^\/project\s+snapshot/i.test(text)) {
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
    await sendPlain(
      env,
      chatId,
      `Snapshot готовий:\n${url}\n(можеш скачати як zip або переглянути у Drive)`
    );
    return true;
  }

  // /project sync idea|progress|tasks
  if (/^\/project\s+sync\s+/i.test(text)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Спочатку активуй проєкт.");
      return true;
    }
    const m = text.match(/^\/project\s+sync\s+(idea|progress|tasks)\b/i);
    if (!m) {
      await sendPlain(
        env,
        chatId,
        "Синтаксис: /project sync idea|progress|tasks"
      );
      return true;
    }
    const section = m[1].toLowerCase();
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
  const system = `Ти — Senti Codex, технічний аналітик. Твоє завдання — описувати вміст зображення так, щоб це було максимально корисно для розробника (UI/UX, компоненти, блоки, ієрархія, верстка). Не вигадуй код без запиту.`;
  const prompt =
    question ||
    "Опиши, що на зображенні, з фокусом на компоненти інтерфейсу, блоки, сітку, шрифти, кольори, структуру верстки.";

  const res = await askVision(env, {
    imageBase64,
    prompt,
    systemHint: system,
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

  // якщо надіслали тільки медіа без тексту і не очікуємо введення назви/ідеї —
  // НЕ генеруємо код, а питаємо, що зробити з медіа
  const hasPhoto = Array.isArray(msg?.photo) && msg.photo.length > 0;
  const hasDocument = !!msg?.document;
  if (
    awaiting === "none" &&
    !textRaw &&
    (hasPhoto || hasDocument)
  ) {
    await sendPlain(
      env,
      chatId,
      "Я отримав медіа для Codex. Напиши, що саме зробити з цим фото/файлом (наприклад: «зроби логотип», «проаналізуй макет», «згенеруй код сторінки»)."
    );
    return true;
  }

  // обробка UI-режимів (force-reply)
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
      `✅ Створено проєкт "${name}". Опиши ідею (я збережу її в idea.md).`
    );
    await kv.put(UI_AWAIT_KEY(userId), "idea_text", { expirationTtl: 3600 });
    return true;
  }

  if (awaiting === "idea_text" && textRaw) {
    const cur = await getCurrentProject(env, userId);
    await kv.delete(UI_AWAIT_KEY(userId));
    if (!cur) {
      await sendPlain(
        env,
        chatId,
        "Не бачу активного проєкту. Натисни ще раз «Створити проєкт»."
      );
      return true;
    }
    const idea = textRaw.trim();
    if (!idea) {
      await sendPlain(env, chatId, "Порожній текст. Спробуй ще раз.");
      return true;
    }
    await writeSection(env, userId, cur, "idea.md", idea);
    await sendPlain(
      env,
      chatId,
      "✅ Ідею збережено в idea.md. Можеш додавати tasks / progress або кидати вимоги для генерації коду."
    );
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
    await sendPlain(env, chatId, `✅ Активний проєкт: "${name}".`);
    return true;
  }

  const curName = await getCurrentProject(env, userId);
  if (!curName) {
    await sendPlain(
      env,
      chatId,
      "Немає активного проєкту. Натисни «Створити проєкт» або «Обрати проєкт»."
    );
    return true;
  }

  // /project-команди
  if (textRaw && textRaw.startsWith("/project")) {
    const handled = await handleCodexCommand(env, chatId, userId, textRaw, sendPlain);
    return handled;
  }

  const idea = (await readSection(env, userId, curName, "idea.md")) || "";
  const tasks = (await readSection(env, userId, curName, "tasks.md")) || "";
  const progress =
    (await readSection(env, userId, curName, "progress.md")) || "";

  const systemHint = [
    "Ти працюєш як Senti Codex — асистент-програміст та архітектор.",
    "У тебе є поточний проєкт користувача.",
    `Назва проєкту: ${curName}`,
    "",
    "Використовуй наступний контекст:",
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
      // ігноруємо
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
      visionSummary = await analyzeImageForCodex(env, {
        lang,
        imageBase64: imgB64,
      });
    } catch {
      visionSummary = "";
    }
  }

  const userText = String(textRaw || "").trim();
  const parts = [];

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
      `- ${nowIso()} — Відповідь Codex: ${(outText || "")
        .slice(0, 120)}…`
    );
  }
  await sendPlain(env, chatId, outText || "Не впевнений.");
}