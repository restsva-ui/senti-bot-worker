// src/lib/codexState.js
// Централізоване сховище стану Codex (персоналізоване для кожного юзера)

// KV ключі
export const CODEX_MEM_KEY = "codex:mem";
export const CODEX_MEM_KEY_CONST = "codex:const";

// Формування KV ключів по юзеру
function modeKey(userId) {
  return `codex:user:${userId}:mode`;
}

function projectKey(userId) {
  return `codex:user:${userId}:current`;
}

function draftKey(userId) {
  return `codex:user:${userId}:draft`;
}

// Безпечне читання JSON
function safeParse(val, fallback = null) {
  try {
    return val ? JSON.parse(val) : fallback;
  } catch {
    return fallback;
  }
}

// ---------------- Codex Mode ----------------

// Увімкнення / вимкнення режиму Codex
export async function setCodexMode(env, userId, mode) {
  try {
    await env.CACHE.put(modeKey(userId), JSON.stringify(!!mode));
  } catch (err) {
    console.error("setCodexMode error:", err);
  }
}

// Отримання статусу режиму Codex
export async function getCodexMode(env, userId) {
  try {
    const raw = await env.CACHE.get(modeKey(userId));
    if (raw === null || raw === undefined) return false;
    return JSON.parse(raw) === true;
  } catch (err) {
    console.error("getCodexMode error:", err);
    return false;
  }
}

// Повне очищення памʼяті Codex для юзера
export async function clearCodexMem(env, userId) {
  try {
    await env.CACHE.delete(modeKey(userId));
    await env.CACHE.delete(projectKey(userId));
    await env.CACHE.delete(draftKey(userId));
  } catch (err) {
    console.error("clearCodexMem error:", err);
  }
}
// ---------------- Current project ----------------

// Встановити активний проєкт юзера
export async function setCurrentProject(env, userId, name) {
  try {
    if (!name || typeof name !== "string") {
      await env.CACHE.delete(projectKey(userId));
      return;
    }

    const normalized = normalizeProjectName(name);
    await env.CACHE.put(projectKey(userId), normalized);
  } catch (err) {
    console.error("setCurrentProject error:", err);
  }
}

// Отримати активний проєкт
export async function getCurrentProject(env, userId) {
  try {
    const raw = await env.CACHE.get(projectKey(userId));
    if (!raw || typeof raw !== "string") return null;

    return normalizeProjectName(raw);
  } catch (err) {
    console.error("getCurrentProject error:", err);
    return null;
  }
}

// Нормалізація імені проєкту
export function normalizeProjectName(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 50);
}

// Список усіх проєктів юзера
export async function listProjects(env, userId) {
  try {
    const prefix = `codex:user:${userId}:project:`;
    const list = await env.CACHE.list({ prefix });

    return list.keys.map(k => k.name.replace(prefix, ""));
  } catch (err) {
    console.error("listProjects error:", err);
    return [];
  }
}

// Створити проєкт
export async function createProject(env, userId, name) {
  const normalized = normalizeProjectName(name);
  const key = `codex:user:${userId}:project:${normalized}`;

  try {
    await env.CACHE.put(key, JSON.stringify({ created: Date.now() }));
    await setCurrentProject(env, userId, normalized);
    return normalized;
  } catch (err) {
    console.error("createProject error:", err);
    return null;
  }
}
// Видалити проєкт
export async function deleteProject(env, userId, name) {
  const normalized = normalizeProjectName(name);
  const key = `codex:user:${userId}:project:${normalized}`;

  try {
    await env.CACHE.delete(key);

    const current = await getCurrentProject(env, userId);
    if (current === normalized) {
      await env.CACHE.delete(projectKey(userId));
    }

    return true;
  } catch (err) {
    console.error("deleteProject error:", err);
    return false;
  }
}

// Робота з idea.md секціями
export async function writeSection(env, userId, project, sectionName, content) {
  const normalized = normalizeProjectName(project);
  const key = `codex:user:${userId}:project:${normalized}:section:${sectionName}`;

  try {
    await env.CACHE.put(key, content);
  } catch (err) {
    console.error("writeSection error:", err);
  }
}

export async function readSection(env, userId, project, sectionName) {
  const normalized = normalizeProjectName(project);
  const key = `codex:user:${userId}:project:${normalized}:section:${sectionName}`;

  try {
    return await env.CACHE.get(key);
  } catch (err) {
    console.error("readSection error:", err);
    return null;
  }
}

export async function appendSection(env, userId, project, sectionName, text) {
  const prev = (await readSection(env, userId, project, sectionName)) || "";
  await writeSection(env, userId, project, sectionName, prev + "\n" + text);
}

// Генерація номера задачі
export async function nextTaskSeq(env, userId, project) {
  const normalized = normalizeProjectName(project);
  const key = `codex:user:${userId}:project:${normalized}:seq`;

  try {
    const raw = await env.CACHE.get(key);
    const num = raw ? Number(raw) : 0;
    const next = num + 1;

    await env.CACHE.put(key, String(next));
    return next;
  } catch (err) {
    console.error("nextTaskSeq error:", err);
    return 1;
  }
}