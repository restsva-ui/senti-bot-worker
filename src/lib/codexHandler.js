// src/lib/codexHandler.js
// Senti Codex: режим коду + "Project Mode" (створення/ведення проєктів разом з юзером).
// Експорти: CODEX_MEM_KEY, setCodexMode, getCodexMode, clearCodexMem,
//          handleCodexCommand, handleCodexGeneration

import { askAnyModel, askVision } from "./modelRouter.js";
import { json } from "./utils.js";

// -------------------- базові ключі/допоміжні --------------------
const CODEX_MODE_KEY = (uid) => `codex:mode:${uid}`;                // "true"/"false"
export const CODEX_MEM_KEY = (uid) => `codex:mem:${uid}`;           // довготривала пам'ять

// Project Mode: активний проєкт юзера + метадані + секції
const PROJ_CURR_KEY = (uid) => `codex:project:current:${uid}`;      // string
const PROJ_META_KEY = (uid, name) => `codex:project:meta:${uid}:${name}`; // json
const PROJ_FILE_KEY = (uid, name, file) => `codex:project:file:${uid}:${name}:${file}`; // text/md/json
const PROJ_TASKSEQ_KEY = (uid, name) => `codex:project:taskseq:${uid}:${name}`;         // number
const PROJ_PREFIX_LIST = (uid) => `codex:project:meta:${uid}:`;     // для .list()

function pickKV(env) {
  return env.STATE_KV || env.CHECKLIST_KV || env.ENERGY_LOG_KV || env.LEARN_QUEUE_KV || null;
}
function nowIso() { return new Date().toISOString().replace('T', ' ').replace('Z', 'Z'); }

// -------------------- вкл/викл Codex --------------------
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

// -------------------- Project Mode: CRUD --------------------
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
  const kv = pickKV(env); if (!kv) return 1;
  const k = PROJ_TASKSEQ_KEY(userId, name);
  const curStr = await kv.get(k); const cur = Number(curStr || "0");
  const nxt = isFinite(cur) ? cur + 1 : 1;
  await kv.put(k, String(nxt), { expirationTtl: 60 * 60 * 24 * 365 });
  return nxt;
}

// шаблонні секції нового проєкту
function templateReadme(name) {
  return `# ${name}
Senti Codex Project

- \`idea.md\` — контракт ідеї (LOCKED - якщо true, Codex не відхиляється).
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
  return `LOCKED: false

## Ідея (контракт)
${initialIdea || "Опишіть бачення/цілі/обмеження. Це — джерело істини."}

## Anti-goals
- Що **не** робимо та чого уникаємо.

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
function templateProgress() { return `# Прогрес\n`; }
function templateTasks() { return `# Tasks\n\n| ID | State | Title |\n|----|-------|-------|\n`; }
function templateDecisions() { return `# ADR\n\n`; }
function templateRisks() { return `# Ризики\n\n`; }
function templateTestplan() { return `# Test Plan\n\n- Саніті\n- Інтерг.тести\n- Приймання\n`; }

async function createProject(env, userId, name, initialIdea) {
  const meta = { name, createdAt: nowIso(), lockedIdea: false };
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

function mdAddTaskRow(md, id, title) {
  const line = `| ${id} | TODO | ${title} |`;
  return md.endsWith("\n") ? md + line + "\n" : md + "\n" + line + "\n";
}
function mdMarkTaskDone(md, id) {
  const lines = md.split("\n");
  const rx = new RegExp(`^\\|\\s*${id}\\s*\\|\\s*[^|]*\\|`);
  return lines.map(l => (rx.test(l) ? l.replace(/\|[^|]*\|/, "| DONE |") : l)).join("\n");
}

// -------------------- збирання Project Context для підказки --------------------
async function buildProjectContext(env, userId) {
  const name = await getCurrentProject(env, userId);
  if (!name) return { name: null, hint: "" };

  const idea = (await readSection(env, userId, name, "idea.md")) || "";
  const spec = (await readSection(env, userId, name, "spec.md")) || "";
  const locked = /^LOCKED:\s*true/mi.test(idea);

  const hint =
`[Project: ${name}]
[Idea Contract]
${idea.slice(0, 2500)}

[Spec (excerpt)]
${spec.slice(0, 2000)}

Rules:
- Answers MUST align with "Idea Contract".${locked ? " (LOCKED)" : ""}
- If user request contradicts the idea, say "Не впевнений — суперечить ідеї" and propose updating idea or unlocking.`;

  return { name, hint, locked };
}
// -------------------- команди Codex (/project …) --------------------
export async function handleCodexCommand(env, chatId, userId, textRaw, sendPlain) {
  const txt = String(textRaw || "").trim();

  // /project new <name> [; idea: ...]
  if (/^\/project\s+new\s+/i.test(txt)) {
    const m = txt.match(/^\/project\s+new\s+(.+)$/i);
    if (!m) return false;
    const tail = m[1].trim();
    let name = tail;
    let idea = "";
    const semi = tail.split(";"); // allow: /project new MyApp ; idea: Simple notes app
    if (semi.length > 1) {
      name = semi[0].trim();
      const ideaM = tail.match(/idea\s*:\s*(.+)$/i);
      idea = ideaM ? ideaM[1].trim() : "";
    }
    if (!name) { await sendPlain(env, chatId, "Вкажи назву: /project new <name>"); return true; }

    await createProject(env, userId, name, idea);
    await sendPlain(env, chatId, `✅ Проєкт **${name}** створено і активовано.\nДоступні секції: README.md, idea.md, spec.md, connectors.md, progress.md, tasks.md, decisions.md, risks.md, testplan.md.`);
    return true;
  }

  // /project use <name>
  if (/^\/project\s+use\s+/i.test(txt)) {
    const name = txt.replace(/^\/project\s+use\s+/i, "").trim();
    if (!name) { await sendPlain(env, chatId, "Вкажи назву: /project use <name>"); return true; }
    const all = await listProjects(env, userId);
    if (!all.includes(name)) { await sendPlain(env, chatId, `Не знайдено: ${name}`); return true; }
    await setCurrentProject(env, userId, name);
    await sendPlain(env, chatId, `🔸 Активний проєкт: **${name}**`);
    return true;
  }

  // /project list
  if (/^\/project\s+list/i.test(txt)) {
    const all = await listProjects(env, userId);
    const cur = await getCurrentProject(env, userId);
    if (!all.length) { await sendPlain(env, chatId, "Немає проєктів. Створи: /project new <name>"); return true; }
    const body = all.map(n => (n === cur ? `• **${n}**  ← active` : `• ${n}`)).join("\n");
    await sendPlain(env, chatId, `Проєкти:\n${body}`);
    return true;
  }

  // /project idea lock|unlock
  if (/^\/project\s+idea\s+(lock|unlock)/i.test(txt)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) { await sendPlain(env, chatId, "Активуй проєкт: /project use <name>"); return true; }
    const wantLock = /lock/i.test(txt);
    let idea = (await readSection(env, userId, cur, "idea.md")) || "";
    if (/^LOCKED:/m.test(idea)) {
      idea = idea.replace(/^LOCKED:\s*(true|false)/mi, `LOCKED: ${wantLock ? "true" : "false"}`);
    } else {
      idea = `LOCKED: ${wantLock ? "true" : "false"}\n\n` + idea;
    }
    await writeSection(env, userId, cur, "idea.md", idea);
    await saveMeta(env, userId, cur, { ...(await readMeta(env, userId, cur)), lockedIdea: !!wantLock });
    await sendPlain(env, chatId, wantLock ? "🔒 Ідею зафіксовано (LOCKED)." : "🔓 Ідею розблоковано.");
    return true;
  }

  // /project idea set <text> | /project idea add <text>
  if (/^\/project\s+idea\s+(set|add)\s+/i.test(txt)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) { await sendPlain(env, chatId, "Активуй проєкт: /project use <name>"); return true; }
    const [, action, rest] = txt.match(/^\/project\s+idea\s+(set|add)\s+([\s\S]+)$/i) || [];
    if (!rest) { await sendPlain(env, chatId, "Дай текст після команди."); return true; }
    if (action === "set") {
      // перезаписуємо, LOCKED лишаємо як було (якщо був)
      const prev = (await readSection(env, userId, cur, "idea.md")) || "";
      const locked = /^LOCKED:\s*true/mi.test(prev);
      const head = `LOCKED: ${locked ? "true" : "false"}\n\n`;
      await writeSection(env, userId, cur, "idea.md", head + rest.trim());
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
    if (!cur) { await sendPlain(env, chatId, "Активуй проєкт: /project use <name>"); return true; }
    const text = txt.replace(/^\/project\s+progress\s+add\s+/i, "").trim();
    if (!text) { await sendPlain(env, chatId, "Дай текст: /project progress add <що зроблено>"); return true; }
    await appendSection(env, userId, cur, "progress.md", `- ${nowIso()} — ${text}`);
    await sendPlain(env, chatId, "📝 Додано у прогрес.");
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
    await sendPlain(env, chatId, `✅ Task #${id} додано.`);
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
    await sendPlain(env, chatId, `✔️ Task #${id} → DONE.`);
    return true;
  }

  // /project status — дайджест
  if (/^\/project\s+status\b/i.test(txt)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) { await sendPlain(env, chatId, "Активуй проєкт: /project use <name>"); return true; }
    const idea = (await readSection(env, userId, cur, "idea.md")) || "";
    const progress = (await readSection(env, userId, cur, "progress.md")) || "";
    const tasks = (await readSection(env, userId, cur, "tasks.md")) || "";
    const locked = /^LOCKED:\s*true/mi.test(idea);
    const body = [
      `📁 ${cur}`,
      locked ? "🔒 Idea: LOCKED" : "🔓 Idea: UNLOCKED",
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
// -------------------- генерація/аналіз у Codex з урахуванням проєкту --------------------
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

/**
 * Головний генератор Codex.
 * ctx: { chatId, userId, msg, textRaw, lang, isAdmin }
 * helpers: { getEnergy, spendEnergy, energyLinks, sendPlain, pickPhoto, tgFileUrl, urlToBase64, describeImage, sendDocument, startPuzzleAnimation, editMessageText }
 */
export async function handleCodexGeneration(env, ctx, helpers) {
  const { chatId, userId, msg, textRaw, lang } = ctx;
  const { sendPlain, pickPhoto, tgFileUrl, urlToBase64, sendDocument, startPuzzleAnimation, editMessageText } = helpers;

  // 1) Проєктний контекст
  const proj = await buildProjectContext(env, userId);
  const systemBlocks = [
    "You are Senti Codex — precise, practical, no hallucinations.",
    "Answer shortly by default. Prefer Markdown.",
  ];
  if (proj.name) systemBlocks.push(proj.hint);
  const systemHint = systemBlocks.join("\n\n");

  // 2) Якщо прийшло фото — робимо аналітику (без HTML)
  const ph = pickPhoto ? pickPhoto(msg) : null;
  if (ph?.file_id) {
    const url = await tgFileUrl(env, ph.file_id);
    const b64 = urlToBase64 ? await urlToBase64(url) : await toBase64FromUrl(url);
    const analysis = await analyzeImageForCodex(env, { lang, imageBase64: b64, question: textRaw || "" });

    // лог: додамо у progress.md якщо є активний проєкт
    if (proj.name) {
      await appendSection(env, userId, proj.name, "progress.md", `- ${nowIso()} — Аналіз зображення: коротко: ${analysis.slice(0,120)}…`);
    }

    await sendPlain(env, chatId, analysis);
    return;
  }

  // 3) Текстове завдання → просимо модель з урахуванням ідеї/специфікації
  const order = String(env.MODEL_ORDER || "").trim()
    || "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-instruct, free:meta-llama/llama-4-scout:free";

  // Якщо ідея LOCKED і запит схоже суперечить (дуже просто: містить "зміни ідеї"), відмовляємось
  if (proj.locked && /зміни\s+іде[їі]|change\s+idea/i.test(textRaw || "")) {
    await sendPlain(env, chatId, "Не впевнений — суперечить поточній зафіксованій ідеї (LOCKED). Розблокуй: /project idea unlock.");
    return;
  }

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