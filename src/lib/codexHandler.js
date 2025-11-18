// src/lib/codexHandler.js
// Головний обробник текстових повідомлень Codex

import {
  UI_AWAIT_KEY,
  normalizeProjectName,
  createProject,
  setCurrentProject,
} from "./codexState.js";

import {
  appendSection,
  readSection,
  writeSection,
} from "./codexState.js";

import { buildCodexKeyboard } from "./codexUi.js";

export async function handleCodexText(env, ctx, helpers = {}) {
  const { userId, chatId, textRaw } = ctx;
  const { sendPlain, sendInline } = helpers;

  const text = (textRaw || "").trim();
  if (!text) return false;

  const kv = env.__KV || env.KV;

  // --------------------------------------------
  // 1. Чи очікуємо введення назви проєкту?
  // --------------------------------------------
  const awaiting = await kv.get(UI_AWAIT_KEY(userId));
  if (awaiting === "proj_name") {
    // Перехоплюємо повністю
    const name = normalizeProjectName(text);
    if (!name) {
      await sendPlain(
        env,
        chatId,
        "Введи коректну назву (1–3 слова). Спробуй ще раз."
      );
      return true;
    }

    // Створити новий Codex-проєкт
    await createProject(env, userId, name);
    await setCurrentProject(env, userId, name);
    await kv.delete(UI_AWAIT_KEY(userId));

    await sendInline(
      env,
      chatId,
      `✅ Проєкт **"${name}"** створено й активовано.`,
      buildCodexKeyboard(true)
    );

    return true; // Senti не відповідає
  }

  // --------------------------------------------
  // 2. Чи очікуємо введення контенту для idea/tasks?
  // --------------------------------------------
  if (awaiting === "idea_append") {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await kv.delete(UI_AWAIT_KEY(userId));
      return false;
    }

    await appendSection(env, userId, cur, "idea.md", `\n${text}`);
    await sendPlain(env, chatId, "Додав до ідеї.");

    await kv.delete(UI_AWAIT_KEY(userId));
    return true;
  }

  if (awaiting === "task_append") {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await kv.delete(UI_AWAIT_KEY(userId));
      return false;
    }

    await appendSection(env, userId, cur, "tasks.md", `\n- ${text}`);
    await sendPlain(env, chatId, "Задачу додано.");

    await kv.delete(UI_AWAIT_KEY(userId));
    return true;
  }

  // --------------------------------------------
  // 3. Якщо Codex не очікує даних → пропускаємо
  // --------------------------------------------
  return false;
}
// Продовження codexHandler

import { getCurrentProject } from "./codexState.js";

export async function handleCodexMedia(env, ctx, helpers = {}) {
  const { userId, chatId, fileUrl, fileName } = ctx;
  const { sendPlain } = helpers;

  const cur = await getCurrentProject(env, userId);
  if (!cur) {
    // Якщо проект не вибраний → Codex НЕ приймає медіа
    return false;
  }

  // Зберегти файл у проєкт
  const progressLine = `- Додано файл: ${fileName}`;
  await appendSection(env, userId, cur, "progress.md", `\n${progressLine}`);

  await sendPlain(
    env,
    chatId,
    `📁 Файл **${fileName}** додано до проєкту **"${cur}"**.`
  );

  return true;
}