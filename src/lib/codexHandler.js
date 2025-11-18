// src/lib/codexHandler.js
// Головний фасад Codex — тут об'єднано текст, медіа, UI та генерацію

// ===============================
// ІМПОРТИ
// ===============================
import {
  UI_AWAIT_KEY,
  normalizeProjectName,
  createProject,
  setCurrentProject,
  getCurrentProject,

  CODEX_MEM_KEY,
  setCodexMode,
  getCodexMode,
  clearCodexMem,
} from "./codexState.js";

import {
  appendSection,
  readSection,
  writeSection,
} from "./codexState.js";

import {
  CB,
  buildCodexKeyboard,
  handleCodexUi,
  handleCodexCommand,
} from "./codexUi.js";

import { handleCodexGeneration } from "./codexGeneration.js";


// ===============================
// ОБРОБКА ТЕКСТУ Codex
// ===============================
export async function handleCodexText(env, ctx, helpers = {}) {
  const { userId, chatId, textRaw } = ctx;
  const { sendPlain, sendInline } = helpers;

  const text = (textRaw || "").trim();
  if (!text) return false;

  const kv = env.__KV || env.KV;

  // --------------------------------------------
  // 1. Очікуємо назву нового проєкту?
  // --------------------------------------------
  const awaiting = await kv.get(UI_AWAIT_KEY(userId));
  if (awaiting === "proj_name") {
    const name = normalizeProjectName(text);

    if (!name) {
      await sendPlain(
        env,
        chatId,
        "Введи коректну назву (1–3 слова). Спробуй ще раз."
      );
      return true; // Senti не відповідає
    }

    await createProject(env, userId, name);
    await setCurrentProject(env, userId, name);
    await kv.delete(UI_AWAIT_KEY(userId));

    await sendInline(
      env,
      chatId,
      `🧠 *Проєкт створено!*\nАктивний проєкт: **${name}**`,
      buildCodexKeyboard(true)
    );

    return true;
  }

  // --------------------------------------------
  // 2. Очікуємо текст для idea.md ?
  // --------------------------------------------
  if (awaiting === "idea_append") {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await kv.delete(UI_AWAIT_KEY(userId));
      return false;
    }

    await appendSection(env, userId, cur, "idea.md", `\n${text}`);
    await sendPlain(env, chatId, "📝 Додав до секції *Ідея*.");

    await kv.delete(UI_AWAIT_KEY(userId));
    return true;
  }

  // --------------------------------------------
  // 3. Очікуємо текст для tasks.md ?
  // --------------------------------------------
  if (awaiting === "task_append") {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await kv.delete(UI_AWAIT_KEY(userId));
      return false;
    }

    await appendSection(env, userId, cur, "tasks.md", `\n- ${text}`);
    await sendPlain(env, chatId, "📌 Задачу додано.");

    await kv.delete(UI_AWAIT_KEY(userId));
    return true;
  }

  return false; // Нічого не перехопили → Senti відповідає
}



// ===============================
// ОБРОБКА МЕДІА Codex
// ===============================
export async function handleCodexMedia(env, ctx, helpers = {}) {
  const { userId, chatId, fileUrl, fileName } = ctx;
  const { sendPlain } = helpers;

  const cur = await getCurrentProject(env, userId);
  if (!cur) {
    return false; // медіа ігнорується → Senti працює
  }

  const line = `- Додано файл: ${fileName}`;
  await appendSection(env, userId, cur, "progress.md", `\n${line}`);

  await sendPlain(
    env,
    chatId,
    `📁 Файл **${fileName}** збережено в проєкт **${cur}**.`
  );

  return true;
}



// ===============================
// ЕКСПОРТИ для webhook.js
// ===============================
export {
  // Стан Codex
  CODEX_MEM_KEY,
  setCodexMode,
  getCodexMode,
  clearCodexMem,

  // UI Codex
  CB,
  buildCodexKeyboard,
  handleCodexUi,
  handleCodexCommand,

  // Генератор Codex
  handleCodexGeneration,
};