// src/lib/codexHandler.js
// Senti Codex: режим коду + "Project Mode" (створення/ведення проєктів разом з юзером).
// Експорти: CODEX_MEM_KEY, setCodexMode, getCodexMode, clearCodexMem,
//          handleCodexCommand, handleCodexGeneration,
//          buildCodexKeyboard, handleCodexUi

import { askAnyModel, askVision } from "./modelRouter.js";

/* ───────────────── базові ключі/допоміжні ───────────────── */
const CODEX_MODE_KEY = (uid) => `codex:mode:${uid}`;                // "true"/"false"
export const CODEX_MEM_KEY = (uid) => `codex:mem:${uid}`;           // довготривала пам'ять

// Project Mode: активний проєкт юзера + метадані + секції
const PROJ_CURR_KEY = (uid) => `codex:project:current:${uid}`;      // string
const PROJ_META_KEY = (uid, name) => `codex:project:meta:${uid}:${name}`; // json
const PROJ_FILE_KEY = (uid, name, file) => `codex:project:file:${uid}:${name}:${file}`; // text/md/json
const PROJ_TASKSEQ_KEY = (uid, name) => `codex:project:taskseq:${uid}:${name}`;         // number
const PROJ_PREFIX_LIST = (uid) => `codex:project:meta:${uid}:`;     // для .list()

// UI-стани для створення проєкту (force-reply / збір ідеї)
const UI_STATE_KEY = (uid) => `codex:ui:${uid}`;                    // json {mode, name}

function pickKV(env) {
  return env.STATE_KV || env.CHECKLIST_KV || env.ENERGY_LOG_KV || env.LEARN_QUEUE_KV || null;
}
function nowIso() { return new Date().toISOString(); }
function safeProjectFolder(name) {
  return String(name || "Project")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/* ───────────────── вкл/викл Codex ───────────────── */
export async function setCodexMode(env, userId, on) {
  const kv = pickKV(env); if (!kv) return;
  await kv.put(CODEX_MODE_KEY(userId), on ? "true" : "false", { expirationTtl: 60 * 60 * 24 * 180 });
}
export async function getCodexMode(env, userId) {
  const kv = pickKV(env); if (!kv) return false;
  const v = await kv.get(CODEX_MODE_KEY(userId), "text");
  return v === "true";
}
export async function clearCodexMem(env, userId) {
  const kv = pickKV(env); if (!kv) return;
  await kv.delete(CODEX_MEM_KEY(userId));
}

/* ───────────────── Project Mode: CRUD ───────────────── */
async function setCurrentProject(env, userId, name) {
  const kv = pickKV(env); if (!kv) return;
  await kv.put(PROJ_CURR_KEY(userId), name, { expirationTtl: 60 * 60 * 24 * 365 });
}
async function getCurrentProject(env, userId) {
  const kv = pickKV(env); if (!kv) return null;
  return await kv.get(PROJ_CURR_KEY(userId), "text");
}
async function saveMeta(env, userId, name, meta) {
  const kv = pickKV(env); if (!kv) return;
  await kv.put(PROJ_META_KEY(userId, name), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 365 });
}
async function readMeta(env, userId, name) {
  const kv = pickKV(env); if (!kv) return null;
  const raw = await kv.get(PROJ_META_KEY(userId, name));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
async function writeSection(env, userId, name, file, content) {
  const kv = pickKV(env); if (!kv) return;
  await kv.put(PROJ_FILE_KEY(userId, name, file), content, { expirationTtl: 60 * 60 * 24 * 365 });
}
async function readSection(env, userId, name, file) {
  const kv = pickKV(env); if (!kv) return null;
  return await kv.get(PROJ_FILE_KEY(userId, name, file));
}
async function appendSection(env, userId, name, file, line) {
  const prev = (await readSection(env, userId, name, file)) || "";
  const next = prev ? (prev.endsWith("\n") ? prev + line : prev + "\n" + line) : line;
  await writeSection(env, userId, name, file, next);
}
async function listProjects(env, userId) {
  const kv = pickKV(env); if (!kv || !kv.list) return [];
  const out = [];
  let cursor = undefined;
  do {
    const res = await kv.list({ prefix: PROJ_PREFIX_LIST(userId), cursor });
    for (const k of (res.keys || [])) {
      const parts = k.name.split(":"); // codex:project:meta:<uid>:<name>
      const name = parts.slice(-1)[0];
      if (name && !out.includes(name)) out.push(name);
    }
    cursor = res.cursor || null;
  } while (cursor);
  return out.sort();
}
async function nextTaskId(env, userId, name) {
  const kv = pickKV(env); if (!kv) return 1;
  const k = PROJ_TASKSEQ_KEY(userId, name);
  const curStr = await kv.get(k); const cur = Number(curStr || "0");
  const nxt = Number.isFinite(cur) ? cur + 1 : 1;
  await kv.put(k, String(nxt), { expirationTtl: 60 * 60 * 24 * 365 });
  return nxt;
}

/* ───────────────── шаблонні секції нового проєкту ───────────────── */
function templateReadme(name) {
  return `# ${name}
Senti Codex Project

- idea.md — контракт ідеї (Codex дотримується цієї ідеї).
- spec.md — вимоги/архітектура.
- connectors.md — інтеграції/секрети/чеклісти.
- progress.md — журнал прогресу.
- tasks.md — TODO/DOING/DONE.
- decisions.md — ADR (журнал рішень).
- risks.md — ризики/пом'якшення.
- testplan.md — тести/приймання.
`;
}
function templateIdea(initialIdea = "") {
  return `## Ідея (контракт)
${initialIdea || "Опишіть бачення/цілі/обмеження. Це — джерело істини."}

## Anti-goals
- Що не робимо та чого уникаємо.

## Цільова аудиторія
- Кого обслуговує продукт.

## Ключові принципи
- Коротко, маркерами.`;
}
function templateSpec() {
  // лише ASCII-бектики
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
function templateProgress() { return `# Прогрес\n`; }
function templateTasks() { return `# Tasks\n\n| ID | State | Title |\n|----|-------|-------|\n`; }
function templateDecisions() { return `# ADR\n\n`; }
function templateRisks() { return `# Ризики\n\n`; }
function templateTestplan() { return `# Test Plan\n\n- Саніті\n- Інтеграційні тести\n- Приймання\n`; }

async function createProject(env, userId, name, initialIdea) {
  const meta = { name, createdAt: nowIso() };
  await saveMeta(env, userId, name, meta);
  await writeSection(env, userId, name, "README.md", templateReadme(name));
  await writeSection(env, userId, name, "idea.md", templateIdea(initialIdea));
  await writeSection(env, userId, name, "spec.md", templateSpec());
  await writeSection(env, userId, name, "connectors.md", templateConnectors());
  await writeSection(env, userId, name, "progress.md", templateProgress());
  await writeSection(env, userId, name, "tasks.md", templateTasks());
  await writeSection(env, userId, name, "decisions.md", templateDecisions());
  await writeSection(env, userId, name, "risks.md", templateRisks());
  await writeSection(env, userId, name, "testplan.md", templateTestplan());
  await setCurrentProject(env, userId, name);
}

/* ───────────────── допоміжне для tasks.md ───────────────── */
function mdAddTaskRow(md, id, title) {
  const line = `| ${id} | TODO | ${title} |`;
  return md.endsWith("\n") ? md + line + "\n" : md + "\n" + line + "\n";
}
function mdMarkTaskDone(md, id) {
  const lines = md.split("\n");
  const rx = new RegExp(`^\\|\\s*${id}\\s*\\|\\s*[^|]*\\|`);
  return lines.map(l => (rx.test(l) ? l.replace(/\|[^|]*\|/, "| DONE |") : l)).join("\n");
}

/* ───────────────── контекст проєкту для підказки ───────────────── */
async function buildProjectContext(env, userId) {
  const name = await getCurrentProject(env, userId);
  if (!name) return { name: null, hint: "" };

  const idea = (await readSection(env, userId, name, "idea.md")) || "";
  const spec = (await readSection(env, userId, name, "spec.md")) || "";

  const hint =
`[Project: ${name}]
[Idea Contract]
${idea.slice(0, 2500)}

[Spec (excerpt)]
${spec.slice(0, 2000)}

Rules:
- Answers MUST align with "Idea Contract".`;

  return { name, hint };
}

/* ───────────────── Inline-меню та UI обробка ───────────────── */
export function buildCodexKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🆕 New Project", callback_data: "codex:new" },
       { text: "📂 Use / List", callback_data: "codex:list" },
       { text: "📊 Status", callback_data: "codex:status" }],
    ],
  };
}

// handleCodexUi: працює як з callback_query, так і з текстом/медіа у стані збору.
// helpers: { sendPlain, tgFileUrl, driveSaveFromUrl, getUserTokens }
export async function handleCodexUi(env, chatId, userId, payload, helpers) {
  const kv = pickKV(env); if (!kv) return false;
  const { sendPlain, tgFileUrl, driveSaveFromUrl, getUserTokens } = helpers || {};
  const stateRaw = await kv.get(UI_STATE_KEY(userId));
  const state = stateRaw ? JSON.parse(stateRaw) : null;

  // 1) Обробка callback кнопок
  if (payload?.cbData) {
    const d = String(payload.cbData || "");
    if (d === "codex:new") {
      await kv.put(UI_STATE_KEY(userId), JSON.stringify({ mode: "ask_name" }), { expirationTtl: 900 });
      await sendPlain(env, chatId, "Введи назву проєкту:", {
        reply_markup: { force_reply: true, selective: true },
      });
      return true;
    }
    if (d === "codex:list") {
      const items = await listProjects(env, userId);
      if (!items.length) {
        await sendPlain(env, chatId, "Немає проєктів. Створи новий.");
        return true;
      }
      // красивий список з вибором
      const rows = [];
      for (const n of items) rows.push([{ text: `📁 ${n}`, callback_data: `codex:use:${n}` }]);
      await sendPlain(env, chatId, "Оберіть активний проєкт:", { reply_markup: { inline_keyboard: rows } });
      return true;
    }
    if (d.startsWith("codex:use:")) {
      const name = d.replace("codex:use:", "");
      const items = await listProjects(env, userId);
      if (!items.includes(name)) {
        await sendPlain(env, chatId, "Не знайдено проєкт.");
        return true;
      }
      await setCurrentProject(env, userId, name);
      await sendPlain(env, chatId, `Активний проєкт: ${name}`);
      return true;
    }
    if (d === "codex:status") {
      const cur = await getCurrentProject(env, userId);
      if (!cur) {
        await sendPlain(env, chatId, "Спочатку створіть або оберіть проєкт.");
        return true;
      }
      const idea = (await readSection(env, userId, cur, "idea.md")) || "";
      const progress = (await readSection(env, userId, cur, "progress.md")) || "";
      const tasks = (await readSection(env, userId, cur, "tasks.md")) || "";
      const body = [
        `📁 ${cur}`,
        "",
        "— Ідея (уривок):",
        "```",
        (idea.trim().slice(0, 500) || "—"),
        "```",
        "",
        "— Останній прогрес:",
        progress.trim().split("\n").slice(-5).join("\n") || "—",
        "",
        "— Tasks (останні рядки):",
        tasks.trim().split("\n").slice(-6).join("\n") || "—",
      ].join("\n");
      await sendPlain(env, chatId, body, { parse_mode: "Markdown" });
      return true;
    }
  }

  // 2) Майстер створення проєкту
  if (state?.mode === "ask_name" && payload?.text) {
    const name = payload.text.trim().replace(/\s+/g, " ").slice(0, 80);
    if (!name) {
      await sendPlain(env, chatId, "Дай коректну назву (не порожню).");
      return true;
    }
    await kv.put(UI_STATE_KEY(userId), JSON.stringify({ mode: "ask_idea", name }), { expirationTtl: 1800 });
    await sendPlain(env, chatId, `Добре. Коротко опиши ідею для **${name}**.\nМожеш додавати фото/файли — я збережу їх у розділ ідеї.`, {
      parse_mode: "Markdown",
      reply_markup: { force_reply: true, selective: true },
    });
    return true;
  }

  if (state?.mode === "ask_idea") {
    // збираємо текст + медіа
    let textAdded = false;
    const folder = safeProjectFolder(state.name);

    if (payload?.text) {
      const txt = payload.text.trim();
      if (txt) {
        const exists = (await listProjects(env, userId)).includes(state.name);
        if (!exists) await createProject(env, userId, state.name, txt);
        else await writeSection(env, userId, state.name, "idea.md", templateIdea(txt));
        await setCurrentProject(env, userId, state.name);
        textAdded = true;
      }
    }

    // медіа → якщо є токени — у Drive під проєкт (idea/)
    if (payload?.attachments?.length && tgFileUrl && driveSaveFromUrl && getUserTokens) {
      let hasTokens = false;
      try { hasTokens = !!(await getUserTokens(env, userId)); } catch {}
      for (const att of payload.attachments) {
        try {
          const url = await tgFileUrl(env, att.file_id);
          const niceName = `${folder}/idea/${nowIso().replace(/[:.]/g, "-")}_${att.name || "file"}`;
          if (hasTokens) {
            const saved = await driveSaveFromUrl(env, userId, url, niceName);
            await appendSection(env, userId, state.name, "progress.md", `- ${nowIso()} — Додано файл до ідеї: ${saved?.name || niceName}`);
          } else {
            await appendSection(env, userId, state.name, "progress.md", `- ${nowIso()} — Додано файл (без Drive): ${att.name || "file"}`);
          }
        } catch {}
      }
    }

    await kv.delete(UI_STATE_KEY(userId));
    await sendPlain(env, chatId, `✅ Проєкт **${state.name}** ${textAdded ? "створено/оновлено" : "оновлено"}.`, { parse_mode: "Markdown" });
    return true;
  }

  return false;
}

/* ───────────────── команди Codex (/project …) ───────────────── */
// Базові /project new|use|list|progress|task|status залишаємо для сумісності.
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
    if (!name) { await sendPlain(env, chatId, "Вкажи назву: /project new <name>"); return true; }
    await createProject(env, userId, name, idea);
    await sendPlain(env, chatId, `✅ Проєкт **${name}** створено і активовано.`, { parse_mode: "Markdown" });
    return true;
  }

  // /project use <name>
  if (/^\/project\s+use\s+/i.test(txt)) {
    const name = txt.replace(/^\/project\s+use\s+/i, "").trim();
    if (!name) { await sendPlain(env, chatId, "Вкажи назву: /project use <name>"); return true; }
    const all = await listProjects(env, userId);
    if (!all.includes(name)) { await sendPlain(env, chatId, `Не знайдено: ${name}`); return true; }
    await setCurrentProject(env, userId, name);
    await sendPlain(env, chatId, `Активний проєкт: ${name}`);
    return true;
  }

  // /project list
  if (/^\/project\s+list/i.test(txt)) {
    const all = await listProjects(env, userId);
    const cur = await getCurrentProject(env, userId);
    if (!all.length) { await sendPlain(env, chatId, "Немає проєктів. Створи: /project new <name>"); return true; }
    const body = all.map(n => (n === cur ? `• ${n}  (active)` : `• ${n}`)).join("\n");
    await sendPlain(env, chatId, `Проєкти:\n${body}`);
    return true;
  }

  // /project progress add <text>
  if (/^\/project\s+progress\s+add\s+/i.test(txt)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) { await sendPlain(env, chatId, "Активуй проєкт: /project use <name>"); return true; }
    const text = txt.replace(/^\/project\s+progress\s+add\s+/i, "").trim();
    if (!text) { await sendPlain(env, chatId, "Дай текст: /project progress add <що зроблено>"); return true; }
    await appendSection(env, userId, cur, "progress.md", `- ${nowIso()} — ${text}`);
    await sendPlain(env, chatId, "Додано у прогрес.");
    return true;
  }

  // /project task add <title>
  if (/^\/project\s+task\s+add\s+/i.test(txt)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) { await sendPlain(env, chatId, "Активуй проєкт: /project use <name>"); return true; }
    const title = txt.replace(/^\/project\s+task\s+add\s+/i, "").trim();
    if (!title) { await sendPlain(env, chatId, "Формат: /project task add <title>"); return true; }
    const id = await nextTaskId(env, userId, cur);
    const md = (await readSection(env, userId, cur, "tasks.md")) || templateTasks();
    await writeSection(env, userId, cur, "tasks.md", mdAddTaskRow(md, id, title));
    await sendPlain(env, chatId, `Task #${id} додано.`);
    return true;
  }

  // /project task done <id>
  if (/^\/project\s+task\s+done\s+/i.test(txt)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) { await sendPlain(env, chatId, "Активуй проєкт: /project use <name>"); return true; }
    const id = Number(txt.replace(/^\/project\s+task\s+done\s+/i, "").trim());
    if (!Number.isFinite(id)) { await sendPlain(env, chatId, "Формат: /project task done <id>"); return true; }
    const md = (await readSection(env, userId, cur, "tasks.md")) || templateTasks();
    await writeSection(env, userId, cur, "tasks.md", mdMarkTaskDone(md, id));
    await sendPlain(env, chatId, `Task #${id} → DONE.`);
    return true;
  }

  // /project status — дайджест
  if (/^\/project\s+status\b/i.test(txt)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) { await sendPlain(env, chatId, "Активуй проєкт: /project use <name>"); return true; }
    const idea = (await readSection(env, userId, cur, "idea.md")) || "";
    const progress = (await readSection(env, userId, cur, "progress.md")) || "";
    const tasks = (await readSection(env, userId, cur, "tasks.md")) || "";
    const body = [
      `📁 ${cur}`,
      "",
      "— Ідея (уривок):",
      "```",
      idea.trim().slice(0, 500),
      "```",
      "",
      "— Останній прогрес:",
      progress.trim().split("\n").slice(-5).join("\n") || "—",
      "",
      "— Tasks (останні рядки):",
      tasks.trim().split("\n").slice(-6).join("\n") || "—",
    ].join("\n");
    await sendPlain(env, chatId, body, { parse_mode: "Markdown" });
    return true;
  }

  // не наша команда
  return false;
}

/* ───────────────── аналіз зображень (для Codex) ───────────────── */
async function toBase64FromUrl(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch image ${r.status}`);
  const ab = await r.arrayBuffer(); const bytes = new Uint8Array(ab);
  let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
async function analyzeImageForCodex(env, { lang = "uk", imageBase64, question }) {
  const order = "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-vision-instruct";
  const systemHint =
`You are Senti Codex. Analyze screenshots/code/logs.
- Be concise: bullet insights + next steps.
- If the image is a log/build error, extract exact errors and probable fixes.
- No HTML. Markdown only.`;

  const userPrompt = question && question.trim()
    ? (lang.startsWith("en") ? `User asks: "${question}"` : `Користувач питає: "${question}"`)
    : (lang.startsWith("en")
        ? "Analyze this image for errors, code context and actionable steps."
        : "Проаналізуй зображення: витягни помилки/контекст коду і дай кроки виправлення.");

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

/* ───────────────── головний генератор Codex ─────────────────
 * ctx: { chatId, userId, msg, textRaw, lang, isAdmin }
 * helpers: {
 *   getEnergy, spendEnergy, energyLinks, sendPlain, pickPhoto, tgFileUrl, urlToBase64,
 *   describeImage, sendDocument, startPuzzleAnimation, editMessageText,
 *   driveSaveFromUrl, getUserTokens
 * }
 */
export async function handleCodexGeneration(env, ctx, helpers) {
  const { chatId, userId, msg, textRaw, lang } = ctx;
  const { sendPlain, pickPhoto, tgFileUrl, urlToBase64 } = helpers;

  // 0) Спершу — можливі UI-стани (назва/ідея/медіа під час створення)
  const attachments = [];
  if (msg?.document) attachments.push({ type: "document", file_id: msg.document.file_id, name: msg.document.file_name });
  if (msg?.photo?.length) {
    const ph = msg.photo[msg.photo.length - 1];
    attachments.push({ type: "photo", file_id: ph.file_id, name: `photo_${ph.file_unique_id}.jpg` });
  }
  const uiHandled = await handleCodexUi(
    env,
    chatId,
    userId,
    { text: textRaw, attachments },
    helpers
  );
  if (uiHandled) return;

  // 1) Проєктний контекст
  const proj = await buildProjectContext(env, userId);
  const systemBlocks = [
    "You are Senti Codex — precise, practical, no hallucinations.",
    "Answer shortly by default. Prefer Markdown.",
  ];
  if (proj.name) systemBlocks.push(proj.hint);
  const systemHint = systemBlocks.join("\n\n");

  // 2) Якщо прийшло фото — аналітика
  const ph = pickPhoto ? pickPhoto(msg) : null;
  if (ph?.file_id) {
    const url = await tgFileUrl(env, ph.file_id);
    const b64 = urlToBase64 ? await urlToBase64(url) : await toBase64FromUrl(url);
    const analysis = await analyzeImageForCodex(env, { lang, imageBase64: b64, question: textRaw || "" });
    await sendPlain(env, chatId, analysis);
    return;
  }

  // 3) Звичайний текст → модель із урахуванням ідеї/специфікації
  const order = String(env.MODEL_ORDER || "").trim()
    || "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-instruct, free:meta-llama/llama-4-scout:free";

  const res = await askAnyModel(env, order, textRaw || "Продовжуй", { systemHint, temperature: 0.2 });
  const outText = typeof res === "string"
    ? res
    : (res?.choices?.[0]?.message?.content || res?.text || JSON.stringify(res));

  // авто-лог у прогрес
  if (proj.name) {
    await appendSection(env, userId, proj.name, "progress.md", `- ${nowIso()} — Відповідь Codex: ${ (outText||"").slice(0,120) }…`);
  }

  await sendPlain(env, chatId, outText || "Не впевнений.");
}