// src/lib/codexState.js
// Загальний стан Codex: ключі KV, проєкти, секції, режими

import { pickKV, nowIso, safeJsonParse } from "./codexUtils.js";

// -------------------- ключі KV --------------------
export const CODEX_MEM_KEY = (uid) => `codex:mem:${uid}`;

const PROJ_CURR_KEY = (uid) => `codex:project:current:${uid}`;
const PROJ_META_KEY = (uid, name) => `codex:project:meta:${uid}:${name}`;
const PROJ_FILE_KEY = (uid, name, file) =>
  `codex:project:file:${uid}:${name}:${file}`;
const PROJ_TASKSEQ_KEY = (uid, name) =>
  `codex:project:taskseq:${uid}:${name}`;
const PROJ_INDEX_KEY = (uid) => `codex:project:index:${uid}`;

const CODEX_UI_PREFIX = (uid) => `codex:ui:${uid}:`;
const CODEX_UI_MODE_KEY = (uid) => `${CODEX_UI_PREFIX(uid)}mode`; // codex|off
const UI_AWAIT_KEY_INTERNAL = (uid) =>
  `codex:ui:await:${uid}`; // none|proj_name|use_name|idea_text|idea_confirm

const IDEA_DRAFT_KEY_INTERNAL = (uid) => `codex:ideaDraft:${uid}`;

// Експорт, щоб інші модулі могли використовувати
export const UI_AWAIT_KEY = UI_AWAIT_KEY_INTERNAL;
export const IDEA_DRAFT_KEY = IDEA_DRAFT_KEY_INTERNAL;

// -------------------- утиліти --------------------
export function normalizeProjectName(name) {
  if (!name) return "Без назви";
  let n = String(name).trim();
  n = n.replace(/^["']+|["']+$/g, ""); // лапки
  n = n.replace(/^[\[\(\{<«]+|[\]\)\}>»]+$/g, ""); // дужки/скоби
  n = n.replace(/\s+/g, " ");
  return n || "Без назви";
}

// -------------------- робота з KV режиму Codex --------------------
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

// -------------------- індекс проєктів --------------------
async function loadProjectIndex(kv, userId) {
  const raw = await kv.get(PROJ_INDEX_KEY(userId), "text");
  if (!raw) return [];
  const obj = safeJsonParse(raw);
  if (!Array.isArray(obj)) return [];
  const uniq = [...new Set(obj)].filter(Boolean);
  return uniq;
}

async function saveProjectIndex(kv, userId, arr) {
  const uniq = [...new Set(arr)].filter(Boolean);
  await kv.put(PROJ_INDEX_KEY(userId), JSON.stringify(uniq), {
    expirationTtl: 60 * 60 * 24 * 365,
  });
}

async function addProjectToIndex(kv, userId, name) {
  const list = await loadProjectIndex(kv, userId);
  if (!list.includes(name)) list.push(name);
  await saveProjectIndex(kv, userId, list);
}

async function removeProjectFromIndex(kv, userId, name) {
  const list = await loadProjectIndex(kv, userId);
  const filtered = list.filter((n) => n !== name);
  await saveProjectIndex(kv, userId, filtered);
}

// -------------------- проєкти в KV --------------------
export async function createProject(env, userId, name, ideaText = "") {
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
  await addProjectToIndex(kv, userId, normalized);
  await setCurrentProject(env, userId, normalized);
}

export async function readMeta(env, userId, name) {
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

export async function listProjects(env, userId) {
  const kv = pickKV(env);
  if (!kv) return [];
  const idx = await loadProjectIndex(kv, userId);
  if (idx.length) return idx;

  // fallback: якщо індекс ще не створений, хоча б повертаємо активний проєкт
  const cur = await kv.get(PROJ_CURR_KEY(userId), "text");
  if (cur) return [normalizeProjectName(cur)];
  return [];
}

export async function deleteProject(env, userId, name) {
  const kv = pickKV(env);
  if (!kv) return;
  const normalized = normalizeProjectName(name);

  await kv.delete(PROJ_META_KEY(userId, normalized));
  await removeProjectFromIndex(kv, userId, normalized);

  // спробуємо прибрати файли, якщо в цьому KV є list()
  if (typeof kv.list === "function") {
    const prefix = `codex:project:file:${userId}:${normalized}:`;
    let cursor;
    do {
      const res = await kv.list({ prefix, cursor });
      for (const k of res.keys || []) {
        await kv.delete(k.name);
      }
      cursor = res.list_complete ? undefined : res.cursor;
    } while (cursor);
  }

  const cur = await kv.get(PROJ_CURR_KEY(userId), "text");
  if (cur && normalizeProjectName(cur) === normalized) {
    await kv.delete(PROJ_CURR_KEY(userId));
  }
}

// -------------------- файли / секції --------------------
export async function writeSection(env, userId, name, file, content) {
  const kv = pickKV(env);
  if (!kv) return;
  await kv.put(PROJ_FILE_KEY(userId, name, file), content, {
    expirationTtl: 60 * 60 * 24 * 365,
  });
}

export async function readSection(env, userId, name, file) {
  const kv = pickKV(env);
  if (!kv) return null;
  return await kv.get(PROJ_FILE_KEY(userId, name, file), "text");
}

export async function appendSection(env, userId, name, file, line) {
  const prev = (await readSection(env, userId, name, file)) || "";
  const next = prev
    ? prev.endsWith("\n")
      ? prev + line
      : prev + "\n" + line
    : line;
  await writeSection(env, userId, name, file, next);
}

export async function nextTaskSeq(env, userId, name) {
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

// -------------------- поточний проєкт --------------------
export async function setCurrentProject(env, userId, name) {
  const kv = pickKV(env);
  if (!kv) return;
  await kv.put(PROJ_CURR_KEY(userId), name, {
    expirationTtl: 60 * 60 * 24 * 365,
  });
}

export async function getCurrentProject(env, userId) {
  const kv = pickKV(env);
  if (!kv) return null;
  return await kv.get(PROJ_CURR_KEY(userId), "text");
}
