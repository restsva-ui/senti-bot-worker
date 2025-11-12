// src/lib/codexHandler.js
// Senti Codex: режим коду + "Project Mode" з простим UI (inline + force-reply)
// + інтеграція Google Drive для структури проєктів, активів і snapshot-експорту.
//
// Експорти: CODEX_MEM_KEY, setCodexMode, getCodexMode, clearCodexMem,
//          handleCodexCommand, handleCodexGeneration,
//          buildCodexKeyboard, handleCodexUi

import { askAnyModel, askVision } from "./modelRouter.js";
import { getUserTokens, putUserTokens } from "./userDrive.js";

// -------------------- базові ключі/допоміжні --------------------
const CODEX_MODE_KEY = (uid) => `codex:mode:${uid}`;                   // "true"/"false"
export const CODEX_MEM_KEY = (uid) => `codex:mem:${uid}`;              // довготривала пам'ять

// Project Mode: активний проєкт юзера + метадані + секції (зберігаємо в KV)
const PROJ_CURR_KEY = (uid) => `codex:project:current:${uid}`;         // string
const PROJ_META_KEY = (uid, name) => `codex:project:meta:${uid}:${name}`; // json
const PROJ_FILE_KEY = (uid, name, file) => `codex:project:file:${uid}:${name}:${file}`; // text/md/json
const PROJ_TASKSEQ_KEY = (uid, name) => `codex:project:taskseq:${uid}:${name}`;         // number
const PROJ_PREFIX_LIST = (uid) => `codex:project:meta:${uid}:`;        // для .list()

// UI-стани (простенька FSM у KV)
const UI_AWAIT_KEY = (uid) => `codex:ui:await:${uid}`;                 // none|proj_name|use_name|idea
const UI_TMPNAME_KEY = (uid) => `codex:ui:tmpname:${uid}`;             // тимчасова назва проєкту

// callback data (inline)
export const CB = {
  NEW: "codex:new",
  LIST: "codex:list",
  USE: "codex:use",
  STATUS: "codex:status",
};

function pickKV(env) {
  return (
    env.STATE_KV ||
    env.CHECKLIST_KV ||
    env.ENERGY_LOG_KV ||
    env.LEARN_QUEUE_KV ||
    null
  );
}
function nowIso() {
  return new Date().toISOString().replace("T", " ").replace("Z", "Z");
}

// ЄДИНА реалізація normName (дубль прибрано)
// — прибирає лапки/дужки, зайві пробіли, зводить до lower-case для порівнянь.
function normName(s = "") {
  return String(s || "")
    .replace(/[<>"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// -------------------- вкл/викл Codex --------------------
export async function setCodexMode(env, userId, on) {
  const kv = pickKV(env);
  if (!kv) return;
  await kv.put(CODEX_MODE_KEY(userId), on ? "true" : "false", {
    expirationTtl: 60 * 60 * 24 * 180,
  });
}
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
  const raw = await kv.get(PROJ_META_KEY(userId, name));
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
  // синхронізуємо оновлену секцію на Drive
  await driveSyncSection(env, userId, name, file, content).catch(() => {});
}
async function readSection(env, userId, name, file) {
  const kv = pickKV(env);
  if (!kv) return null;
  return await kv.get(PROJ_FILE_KEY(userId, name, file));
}
async function appendSection(env, userId, name, file, line) {
  const prev = (await readSection(env, userId, name, file)) || "";
  const next = prev ? (prev.endsWith("\n") ? prev + line : prev + "\n" + line) : line;
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
async function nextTaskId(env, userId, name) {
  const kv = pickKV(env);
  if (!kv) return 1;
  const k = PROJ_TASKSEQ_KEY(userId, name);
  const curStr = await kv.get(k);
  const cur = Number(curStr || "0");
  const nxt = isFinite(cur) ? cur + 1 : 1;
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
(Тут Codex автоматично додає посилання/назви на файли/зображення, що ви надішлете.)

## Цільова аудиторія
- Кого обслуговує продукт.

## Ключові принципи
- Коротко, маркерами.`;
}
function templateSpec() {
  return `# Специфікація / Архітектура
- Модулі:
- API/Інтеграції:
- Дані/Сховища:
- Edge/Workers/Limits:
`;
}
function templateConnectors() {
  return `# Інтеграції та секрети (плейсхолдери)
GEMINI_API_KEY=<set in secrets>
CLOUDFLARE_API_TOKEN=<set in secrets>
OPENROUTER_API_KEY=<set in secrets>

## Чекліст
- [ ] Додати ключі в Secrets/Bindings
- [ ] Перевірити змінні в wrangler.toml
`;
}
function templateProgress() {
  return `# Прогрес\n`;
}
function templateTasks() {
  return `# Tasks\n\n| ID | State | Title |\n|----|-------|-------|\n`;
}
function templateDecisions() {
  return `# ADR\n\n`;
}
function templateRisks() {
  return `# Ризики\n\n`;
}
function templateTestplan() {
  return `# Test Plan\n\n- Саніті\n- Інтегр. тести\n- Приймання\n`;
}

// ---- Google Drive інтеграція (локальні утиліти в цьому файлі) -------------
const SEC = () => Math.floor(Date.now() / 1000);

async function refreshAccessToken(env, tokens) {
  const params = new URLSearchParams();
  params.set("client_id", env.GOOGLE_CLIENT_ID);
  params.set("client_secret", env.GOOGLE_CLIENT_SECRET);
  params.set("grant_type", "refresh_token");
  params.set("refresh_token", tokens.refresh_token);

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(
      `google_refresh_failed: ${r.status} ${r.statusText} :: ${JSON.stringify(
        d
      )}`
    );
  return {
    access_token: d.access_token,
    refresh_token: tokens.refresh_token,
    expiry: SEC() + Number(d.expires_in || 3600) - 60,
  };
}
async function ensureAccessToken(env, userId) {
  let tokens = await getUserTokens(env, userId);
  if (!tokens || !tokens.access_token) throw new Error("no_tokens");
  if (Number(tokens.expiry || 0) > SEC() + 15) return tokens;
  if (tokens.refresh_token) {
    const next = await refreshAccessToken(env, tokens);
    await putUserTokens(env, userId, next);
    return next;
  }
  throw new Error("expired_no_refresh");
}

async function driveFetch(env, userId, url, init = {}) {
  const tokens = await ensureAccessToken(env, userId);
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${tokens.access_token}`);
  return await fetch(url, { ...init, headers });
}

// пошук/створення папки за назвою в межах батьківської
async function driveFindOrCreateFolder(env, userId, name, parentId = "root") {
  const q = `'${parentId}' in parents and name='${String(name)
    .replace(/'/g, "\\'")
    }' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const listUrl = new URL("https://www.googleapis.com/drive/v3/files");
  listUrl.searchParams.set("q", q);
  listUrl.searchParams.set("fields", "files(id,name)");
  const r = await driveFetch(env, userId, listUrl.toString());
  const j = await r.json().catch(() => ({}));
  const found = Array.isArray(j.files) && j.files[0];
  if (found) return found.id;

  // створюємо
  const create = await driveFetch(
    env,
    userId,
    "https://www.googleapis.com/drive/v3/files",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: parentId === "root" ? undefined : [parentId],
      }),
    }
  );
  const created = await create.json().catch(() => ({}));
  if (!create.ok || !created?.id)
    throw new Error("drive_folder_create_failed");
  return created.id;
}

// шлях із кількох папок: повертає id останньої
async function driveEnsurePath(env, userId, parts) {
  let parent = "root";
  for (const name of parts)
    parent = await driveFindOrCreateFolder(env, userId, name, parent);
  return parent;
}

// завантаження текстового файлу (створити/перезаписати) у конкретну папку
async function driveUploadText(env, userId, { parentId, name, content }) {
  const boundary = `senti-${crypto.randomUUID()}`;
  const metadata = {
    name,
    mimeType: "text/markdown",
    parents: parentId === "root" ? undefined : [parentId],
  };
  const enc = new TextEncoder();
  const pre =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
      metadata
    )}\r\n` +
    `--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n`;
  const post = `\r\n--${boundary}--`;
  const body = new Blob(
    [enc.encode(pre), enc.encode(content || ""), enc.encode(post)],
    { type: `multipart/related; boundary=${boundary}` }
  );

  const url = new URL("https://www.googleapis.com/upload/drive/v3/files");
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("fields", "id,name,webViewLink");
  const up = await driveFetch(env, userId, url.toString(), {
    method: "POST",
    body,
  });
  const data = await up.json().catch(() => ({}));
  if (!up.ok)
    throw new Error(
      `drive_upload_text_failed ${up.status} ${up.statusText}`
    );
  return data;
}

// синхронізація однієї секції у /repo
async function driveSyncSection(env, userId, project, file, content) {
  try {
    const root = await driveEnsurePath(env, userId, [
      "SentiCodex",
      String(userId),
      project,
      "repo",
    ]);
    await driveUploadText(env, userId, { parentId: root, name: file, content });
  } catch (_) {
    /* тихо ігноруємо, щоб нічого не ламати */
  }
}

// початкова структура та пуш усіх секцій
async function driveBootstrapProject(env, userId, name, initialSections) {
  try {
    const base = await driveEnsurePath(env, userId, [
      "SentiCodex",
      String(userId),
      name,
    ]);
    await driveEnsurePath(env, userId, [
      "SentiCodex",
      String(userId),
      name,
      "assets",
    ]);
    const repo = await driveEnsurePath(env, userId, [
      "SentiCodex",
      String(userId),
      name,
      "repo",
    ]);
    await driveEnsurePath(env, userId, [
      "SentiCodex",
      String(userId),
      name,
      "exports",
    ]);
    // первинний вивантаж секцій
    for (const [fname, body] of Object.entries(initialSections || {})) {
      await driveUploadText(env, userId, {
        parentId: repo,
        name: fname,
        content: body || "",
      });
    }
    return base;
  } catch (_) {
    return null;
  }
}

// створення snapshot-папки з поточними секціями (для подальшого «Download as ZIP» у Drive)
async function driveExportSnapshot(env, userId, project, snapshotName, allSections) {
  try {
    const exportsId = await driveEnsurePath(env, userId, [
      "SentiCodex",
      String(userId),
      project,
      "exports",
      snapshotName,
    ]);
    for (const [fname, body] of Object.entries(allSections || {})) {
      await driveUploadText(env, userId, {
        parentId: exportsId,
        name: fname,
        content: body || "",
      });
    }
    // README з інструкцією
    const readme = `Це знімок проєкту "${project}".
Щоб отримати ZIP: у Google Drive оберіть цю папку → "Download".`;
    await driveUploadText(env, userId, {
      parentId: exportsId,
      name: "README.txt",
      content: readme,
    });
  } catch (_) {
    /* ігнор */
  }
}

// ---- утиліти таблиці tasks.md ----
function mdAddTaskRow(md, id, title) {
  const line = `| ${id} | TODO | ${title} |`;
  return md.endsWith("\n") ? md + line + "\n" : md + "\n" + line + "\n";
}
function mdMarkTaskDone(md, id) {
  const lines = md.split("\n");
  const rx = new RegExp(`^\\|\\s*${id}\\s*\\|\\s*[^|]*\\|`);
  return lines
    .map((l) => (rx.test(l) ? l.replace(/\|[^|]*\|/, "| DONE |") : l))
    .join("\n");
}

// -------------------- Project Context для підказки --------------------
async function buildProjectContext(env, userId) {
  const name = await getCurrentProject(env, userId);
  if (!name) return { name: null, hint: "" };

  const idea = (await readSection(env, userId, name, "idea.md")) || "";
  const spec = (await readSection(env, userId, name, "spec.md")) || "";

  const hint = `[Project: ${name}]
[Idea Contract]
${idea.slice(0, 2500)}

[Spec (excerpt)]
${spec.slice(0, 2000)}

Rules:
- Answers MUST align with "Idea Contract". If user asks something out-of-scope, say: "Не впевнений — суперечить ідеї" і запропонуй оновити ідею.`;

  return { name, hint };
}

// -------------------- INLINE UI --------------------
export function buildCodexKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "➕ Створити проєкт", callback_data: CB.NEW }],
      [{ text: "📂 Обрати проєкт", callback_data: CB.USE }],
      [{ text: "📋 Статус", callback_data: CB.STATUS }],
      [{ text: "🗂 Список", callback_data: CB.LIST }],
    ],
  };
}

/**
 * handleCodexUi: обробляє callback_data з inline-меню.
 * helpers: { sendPlain }
 */
export async function handleCodexUi(env, chatId, userId, { cbData }, helpers = {}) {
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
    await kv.put(UI_AWAIT_KEY(userId), "use_name", { expirationTtl: 3600 });
    await sendPlain(env, chatId, "Введи назву проєкту, який хочеш зробити активним:", {
      reply_markup: {
        force_reply: true,
        input_field_placeholder: "Назва існуючого проєкту",
      },
    });
    return true;
  }

  if (cbData === CB.LIST) {
    const all = await listProjects(env, userId);
    const cur = await getCurrentProject(env, userId);
    if (!all.length) {
      await sendPlain(env, chatId, "Поки що немає проєктів. Натисни «Створити проєкт».");
      return true;
    }
    const body = all.map((n, i) => `${i + 1}. ${n}${n === cur ? " (active)" : ""}`).join("\n");
    await sendPlain(env, chatId, `Проєкти:\n${body}`);
    return true;
  }

  if (cbData === CB.STATUS) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Активуй або створи проєкт.");
      return true;
    }
    const idea = (await readSection(env, userId, cur, "idea.md")) || "";
    const progress = (await readSection(env, userId, cur, "progress.md")) || "";
    const tasks = (await readSection(env, userId, cur, "tasks.md")) || "";
    const body = [
      `📁 ${cur}`,
      "",
      "— Ідея (уривок):",
      idea.trim().slice(0, 500) || "—",
      "",
      "— Останній прогрес:",
      progress.trim().split("\n").slice(-5).join("\n") || "—",
      "",
      "— Tasks (останні рядки):",
      tasks.trim().split("\n").slice(-6).join("\n") || "—",
    ].join("\n");
    await sendPlain(env, chatId, body);
    return true;
  }

  return false;
}

// -------------------- /project ... (сумісність) --------------------
export async function handleCodexCommand(env, chatId, userId, textRaw, sendPlain) {
  const txt = String(textRaw || "").trim();

  // /project new <name> [; idea: ...]
  if (/^\/project\s+new\s+/i.test(txt)) {
    const m = txt.match(/^\/project\s+new\s+(.+)$/i);
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
    await sendPlain(env, chatId, `✅ Проєкт ${name} створено і активовано.`);
    return true;
  }

  // /project use <name>
  if (/^\/project\s+use\s+/i.test(txt)) {
    const nameInput = txt.replace(/^\/project\s+use\s+/i, "").trim();
    if (!nameInput) {
      await sendPlain(env, chatId, "Вкажи назву: /project use <name>");
      return true;
    }
    const all = await listProjects(env, userId);
    const target = all.find((n) => normName(n) === normName(nameInput));
    if (!target) {
      await sendPlain(env, chatId, `Не знайдено: ${nameInput}`);
      return true;
    }
    await setCurrentProject(env, userId, target);
    await sendPlain(env, chatId, `Активний проєкт: ${target}`);
    return true;
  }

  // /project list
  if (/^\/project\s+list/i.test(txt)) {
    const all = await listProjects(env, userId);
    const cur = await getCurrentProject(env, userId);
    if (!all.length) {
      await sendPlain(env, chatId, "Немає проєктів. Створи: /project new <name>");
      return true;
    }
    const body = all
      .map((n, i) => `${i + 1}. ${n}${n === cur ? " (active)" : ""}`)
      .join("\n");
    await sendPlain(env, chatId, `Проєкти:\n${body}`);
    return true;
  }

  // /project idea set|add <text>
  if (/^\/project\s+idea\s+(set|add)\s+/i.test(txt)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Активуй проєкт: /project use <name>");
      return true;
    }
    const [, action, rest] = txt.match(
      /^\/project\s+idea\s+(set|add)\s+([\s\S]+)$/i
    ) || [];
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
      await appendSection(env, userId, cur, "idea.md", `\n\n${rest.trim()}`);
      await sendPlain(env, chatId, "➕ Додано до ідеї (add).");
    }
    return true;
  }

  // /project progress add <text>
  if (/^\/project\s+progress\s+add\s+/i.test(txt)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Активуй проєкт: /project use <name>");
      return true;
    }
    const text = txt.replace(/^\/project\s+progress\s+add\s+/i, "").trim();
    if (!text) {
      await sendPlain(env, chatId, "Дай текст: /project progress add <що зроблено>");
      return true;
    }
    await appendSection(env, userId, cur, "progress.md", `- ${nowIso()} — ${text}`);
    await sendPlain(env, chatId, "📝 Додано у прогрес.");
    return true;
  }

  // /project task add <title>
  if (/^\/project\s+task\s+add\s+/i.test(txt)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Активуй проєкт: /project use <name>");
      return true;
    }
    const title = txt.replace(/^\/project\s+task\s+add\s+/i, "").trim();
    if (!title) {
      await sendPlain(env, chatId, "Формат: /project task add <title>");
      return true;
    }
    const id = await nextTaskId(env, userId, cur);
    const md = (await readSection(env, userId, cur, "tasks.md")) || templateTasks();
    await writeSection(env, userId, cur, "tasks.md", mdAddTaskRow(md, id, title));
    await sendPlain(env, chatId, `✅ Task #${id} додано.`);
    return true;
  }

  // /project task done <id>
  if (/^\/project\s+task\s+done\s+/i.test(txt)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Активуй проєкт: /project use <name>");
      return true;
    }
    const id = Number(txt.replace(/^\/project\s+task\s+done\s+/i, "").trim());
    if (!Number.isFinite(id)) {
      await sendPlain(env, chatId, "Формат: /project task done <id>");
      return true;
    }
    const md = (await readSection(env, userId, cur, "tasks.md")) || templateTasks();
    await writeSection(env, userId, cur, "tasks.md", mdMarkTaskDone(md, id));
    await sendPlain(env, chatId, `✔️ Task #${id} → DONE.`);
    return true;
  }

  // /project export — створити snapshot у Drive/exports/<timestamp> (звідти Download as ZIP)
  if (/^\/project\s+export\b/i.test(txt)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Активуй проєкт: /project use <name>");
      return true;
    }
    const sections = {
      "README.md": (await readSection(env, userId, cur, "README.md")) || "",
      "idea.md": (await readSection(env, userId, cur, "idea.md")) || "",
      "spec.md": (await readSection(env, userId, cur, "spec.md")) || "",
      "connectors.md":
        (await readSection(env, userId, cur, "connectors.md")) || "",
      "progress.md":
        (await readSection(env, userId, cur, "progress.md")) || "",
      "tasks.md": (await readSection(env, userId, cur, "tasks.md")) || "",
      "decisions.md":
        (await readSection(env, userId, cur, "decisions.md")) || "",
      "risks.md": (await readSection(env, userId, cur, "risks.md")) || "",
      "testplan.md":
        (await readSection(env, userId, cur, "testplan.md")) || "",
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await driveExportSnapshot(env, userId, cur, stamp, sections).catch(() => {});
    await sendPlain(
      env,
      chatId,
      `📦 Експорт створено: exports/${stamp}\nУ Google Drive обери цю папку → Download, щоб отримати ZIP.`
    );
    return true;
  }

  // /project status — дайджест
  if (/^\/project\s+status\b/i.test(txt)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Активуй проєкт: /project use <name>");
      return true;
    }
    const idea = (await readSection(env, userId, cur, "idea.md")) || "";
    const progress = (await readSection(env, userId, cur, "progress.md")) || "";
    const tasks = (await readSection(env, userId, cur, "tasks.md")) || "";
    const body = [
      `📁 ${cur}`,
      "",
      "— Ідея (уривок):",
      idea.trim().slice(0, 500) || "—",
      "",
      "— Останній прогрес:",
      progress.trim().split("\n").slice(-5).join("\n") || "—",
      "",
      "— Tasks (останні рядки):",
      tasks.trim().split("\n").slice(-6).join("\n") || "—",
    ].join("\n");
    await sendPlain(env, chatId, body);
    return true;
  }

  // не наша команда
  return false;
}

// -------------------- створення проєкту (+ Drive bootstrap) --------------------
async function createProject(env, userId, name, initialIdea) {
  const meta = { name, createdAt: nowIso() };
  await saveMeta(env, userId, name, meta);

  const sections = {
    "README.md": templateReadme(name),
    "idea.md": templateIdea(initialIdea),
    "spec.md": templateSpec(),
    "connectors.md": templateConnectors(),
    "progress.md": templateProgress(),
    "tasks.md": templateTasks(),
    "decisions.md": templateDecisions(),
    "risks.md": templateRisks(),
    "testplan.md": templateTestplan(),
  };

  for (const [fname, body] of Object.entries(sections)) {
    await writeSection(env, userId, name, fname, body);
  }

  // Стартова структура на Drive (якщо вже підключений)
  await driveBootstrapProject(env, userId, name, sections).catch(() => {});
  await setCurrentProject(env, userId, name);
}

// -------------------- аналіз зображень для Codex --------------------
async function toBase64FromUrl(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch image ${r.status}`);
  const ab = await r.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function analyzeImageForCodex(env, { lang = "uk", imageBase64, question }) {
  const order =
    "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-vision-instruct";
  const systemHint = `You are Senti Codex. Analyze screenshots/code/logs.
- Be concise: bullet insights + next steps.
- If the image is a log/build error, extract exact errors and probable fixes.
- No HTML. Markdown only.`;

  const userPrompt =
    question && question.trim()
      ? (lang.startsWith("en")
          ? `User asks: "${question}"`
          : `Користувач питає: "${question}"`)
      : lang.startsWith("en")
        ? "Analyze this image for errors, code context and actionable steps."
        : "Проаналізуй зображення: витягни помилки/контекст коду і дай кроки виправлення.";

  const out = await askVision(env, order, userPrompt, {
    systemHint,
    imageBase64,
    imageMime: "image/png",
    temperature: 0.2,
  });
  if (typeof out === "string") return out;
  if (out?.text) return out.text;
  return JSON.stringify(out);
}

// -------------------- головний генератор Codex --------------------
/**
 * ctx: { chatId, userId, msg, textRaw, lang, isAdmin }
 * helpers: {
 *   sendPlain, pickPhoto, tgFileUrl, urlToBase64
 * }
 */
export async function handleCodexGeneration(env, ctx, helpers) {
  const { chatId, userId, msg, textRaw, lang } = ctx;
  const { sendPlain, pickPhoto, tgFileUrl, urlToBase64 } = helpers;
  const kv = pickKV(env);

  // 0) UI-стани (force-reply): створення назви, вибір проєкту, набір ідеї з медіа
  const awaiting = (await kv.get(UI_AWAIT_KEY(userId), "text")) || "none";

  // нова назва проєкту
  if (awaiting === "proj_name" && textRaw) {
    const name = textRaw.trim();
    await kv.delete(UI_AWAIT_KEY(userId));
    if (!name) {
      await sendPlain(env, chatId, "Пуста назва. Спробуй ще раз через меню.");
      return;
    }
    await createProject(env, userId, name, "");
    await sendPlain(
      env,
      chatId,
      `✅ Проєкт «${name}» створено і активовано.\nТепер опиши коротко ідею (можеш додавати фото/файли) — все прикріплю до проєкту.`
    );
    await kv.put(UI_AWAIT_KEY(userId), "idea", { expirationTtl: 3600 });
    await kv.put(UI_TMPNAME_KEY(userId), name, { expirationTtl: 3600 });
    return;
  }

  // вибір існуючого проєкту
  if (awaiting === "use_name" && textRaw) {
    const nameInput = textRaw.trim();
    await kv.delete(UI_AWAIT_KEY(userId));
    const all = await listProjects(env, userId);
    const target = all.find((n) => normName(n) === normName(nameInput));
    if (!target) {
      await sendPlain(env, chatId, `Не знайдено: ${nameInput}`);
      return;
    }
    await setCurrentProject(env, userId, target);
    await sendPlain(env, chatId, `Активний проєкт: ${target}`);
    return;
  }

  // режим набору ідеї: приймаємо текст і медіа, пишемо в idea.md + кладемо файли в Drive/assets
  if (awaiting === "idea") {
    const cur =
      (await getCurrentProject(env, userId)) ||
      (await kv.get(UI_TMPNAME_KEY(userId), "text"));
    if (!cur) {
      await kv.delete(UI_AWAIT_KEY(userId));
      await sendPlain(
        env,
        chatId,
        "Не бачу активного проєкту. Створи або обери в меню."
      );
      return;
    }

    if (textRaw)
      await appendSection(env, userId, cur, "idea.md", `\n\n${textRaw.trim()}`);

    const photo = pickPhoto ? pickPhoto(msg) : null;
    const doc = msg?.document || null;
    const voice = msg?.voice || null;
    const video = msg?.video || null;

    async function saveAsset(fileId, defaultName) {
      try {
        // Отримаємо прямий URL файлу TG
        const url = await tgFileUrl(env, fileId);
        // Кладемо у папку assets:
        const base = await driveEnsurePath(env, userId, [
          "SentiCodex",
          String(userId),
          cur,
          "assets",
        ]);
        // Завантаження multipart
        const resp = await fetch(url);
        if (!resp.ok) throw new Error("tg_file_fetch_failed");
        const buf = await resp.arrayBuffer();

        const boundary = `senti-${crypto.randomUUID()}`;
        const meta = { name: defaultName, parents: [base] };
        const pre =
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
            meta
          )}\r\n` +
          `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`;
        const post = `\r\n--${boundary}--`;
        const body = new Blob(
          [
            new TextEncoder().encode(pre),
            new Uint8Array(buf),
            new TextEncoder().encode(post),
          ],
          { type: `multipart/related; boundary=${boundary}` }
        );

        const urlUp = new URL(
          "https://www.googleapis.com/upload/drive/v3/files"
        );
        urlUp.searchParams.set("uploadType", "multipart");
        urlUp.searchParams.set("fields", "id,name,webViewLink");
        const up = await driveFetch(env, userId, urlUp.toString(), {
          method: "POST",
          body,
        });
        if (!up.ok) throw new Error("asset_upload_failed");
        return true;
      } catch {
        return false;
      }
    }

    const saved = [];
    if (photo?.file_id)
      if (
        await saveAsset(
          photo.file_id,
          photo.name || `photo_${Date.now()}.jpg`
        )
      )
        saved.push("photo");
    if (doc?.file_id)
      if (await saveAsset(doc.file_id, doc.file_name || `doc_${Date.now()}`))
        saved.push("document");
    if (voice?.file_id)
      if (await saveAsset(voice.file_id, `voice_${voice.file_unique_id}.ogg`))
        saved.push("voice");
    if (video?.file_id)
      if (
        await saveAsset(
          video.file_id,
          video.file_name || `video_${Date.now()}.mp4`
        )
      )
        saved.push("video");

    if (saved.length) {
      await appendSection(
        env,
        userId,
        cur,
        "idea.md",
        `\n\nДодаткові матеріали (${nowIso()}):\n- ${saved.join("\n- ")}`
      );
    }
    await sendPlain(
      env,
      chatId,
      "Прийнято. Можеш додавати ще ідей/матеріалів або продовжуй роботу в цьому проєкті."
    );
    return;
  }

  // 1) Проєктний контекст
  const proj = await buildProjectContext(env, userId);
  const systemBlocks = [
    "You are Senti Codex — precise, practical, no hallucinations.",
    "Answer shortly by default. Prefer Markdown.",
  ];
  if (proj.name) systemBlocks.push(proj.hint);
  const systemHint = systemBlocks.join("\n\n");

  // 2) Якщо прийшло фото — аналітика (без HTML)
  const ph = pickPhoto ? pickPhoto(msg) : null;
  if (ph?.file_id) {
    const url = await tgFileUrl(env, ph.file_id);
    const b64 = urlToBase64 ? await urlToBase64(url) : await toBase64FromUrl(url);
    const analysis = await analyzeImageForCodex(env, {
      lang,
      imageBase64: b64,
      question: textRaw || "",
    });

    if (proj.name) {
      await appendSection(
        env,
        userId,
        proj.name,
        "progress.md",
        `- ${nowIso()} — Аналіз зображення: коротко: ${analysis.slice(0, 120)}…`
      );
    }
    await sendPlain(env, chatId, analysis);
    return;
  }

  // 3) Текстове завдання
  const order =
    String(env.MODEL_ORDER || "").trim() ||
    "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-instruct, free:meta-llama/llama-4-scout:free";

  const res = await askAnyModel(env, order, textRaw || "Продовжуй", {
    systemHint,
    temperature: 0.2,
  });
  const outText =
    typeof res === "string"
      ? res
      : res?.choices?.[0]?.message?.content || res?.text || JSON.stringify(res);

  if (proj.name) {
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
