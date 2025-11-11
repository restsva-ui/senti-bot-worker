// src/routes/webhook.js

import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { think } from "../lib/brain.js";
import { readStatut } from "../lib/kvChecklist.js";
import { askAnyModel } from "../lib/modelRouter.js";
import { json } from "../lib/utils.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { buildDialogHint, pushTurn } from "../lib/dialogMemory.js";
import { loadSelfTune, autoUpdateSelfTune } from "../lib/selfTune.js";
import { setDriveMode, getDriveMode } from "../lib/driveMode.js";
import { t, pickReplyLanguage } from "../lib/i18n.js";
import { TG } from "../lib/tg.js";
import {
  enqueueLearn,
  listQueued,
  dequeueLearn,
  CODEX_MEM_KEY,
} from "../lib/learnQueue.js";
import { loadUserState, saveUserState } from "../lib/userState.js";

// кнопки TG
const {
  reply,
  answerCallback,
  editMessageText,
  pickText,
  buildInlineKeyboard,
  parseTgMessage,
  pickPhoto,
  pickDocument,
  buildUrlKeyboard,
  askLocationKeyboard,
} = TG;

// ===== KV KEYS =====
const KV = {
  learnMode: (uid) => `learn:mode:${uid}`,
  codexMode: (uid) => `codex:mode:${uid}`,
};

// останній витягнутий код зі скріну
const LAST_VISION_CODE = (uid) => `vision:last_code:${uid}`;

// коротка пам'ять vision
const VISION_MEM = (uid) => `vision:mem:${uid}`;

// проєктна пам'ять
const PROJECT_CURRENT = (uid) => `proj:current:${uid}`;
const PROJECT_PREFIX = (uid, name) => `proj:${uid}:${name}:`;

function getFileNameFromUrl(u) {
  try {
    const url = new URL(u);
    const parts = url.pathname.split("/");
    return parts[parts.length - 1] || "file";
  } catch (e) {
    return "file";
  }
}

// ===== Project memory =====
async function getCurrentProject(env, userId) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return "default";
  const p = await kv.get(PROJECT_CURRENT(userId), "text");
  return p || "default";
}
async function setCurrentProject(env, userId, name) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  await kv.put(PROJECT_CURRENT(userId), name, {
    expirationTtl: 60 * 60 * 24 * 180,
  });
}
async function loadProjectMem(env, userId, project) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return {};
  const raw = await kv.get(PROJECT_PREFIX(userId, project) + "meta", "json");
  return raw || {};
}
async function saveProjectMem(env, userId, project, data) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  await kv.put(PROJECT_PREFIX(userId, project) + "meta", JSON.stringify(data), {
    expirationTtl: 60 * 60 * 24 * 180,
  });
}

// ====== vision helpers ======
async function saveVisionCode(env, userId, code) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  await kv.put(LAST_VISION_CODE(userId), code, { expirationTtl: 60 * 60 * 6 });
}
async function loadVisionCode(env, userId) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return null;
  return await kv.get(LAST_VISION_CODE(userId), "text");
}
async function saveVisionMem(env, userId, data) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  await kv.put(VISION_MEM(userId), JSON.stringify(data), {
    expirationTtl: 60 * 60 * 6,
  });
}
async function loadVisionMem(env, userId) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return null;
  const raw = await kv.get(VISION_MEM(userId), "json");
  return raw || null;
}

// ====== режим навчання / codex ======
async function isLearnMode(env, userId) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return false;
  const v = await kv.get(KV.learnMode(userId), "text");
  return v === "1";
}
async function setLearnMode(env, userId, on) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  await kv.put(KV.learnMode(userId), on ? "1" : "0", {
    expirationTtl: 60 * 60 * 24 * 7,
  });
}
async function isCodexMode(env, userId) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return false;
  const v = await kv.get(KV.codexMode(userId), "text");
  return v === "1";
}
async function setCodexMode(env, userId, on) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  await kv.put(KV.codexMode(userId), on ? "1" : "0", {
    expirationTtl: 60 * 60 * 24 * 7,
  });
}

function buildMainKeyboard(lang = "uk") {
  return {
    inline_keyboard: [
      [
        { text: "Senti 🧠", callback_data: "senti:main" },
        { text: "Codex 💻", callback_data: "codex:main" },
      ],
      [
        { text: "Drive 📁", callback_data: "drive:main" },
        { text: "Admin ⚙️", callback_data: "admin:main" },
      ],
      [
        { text: "Проєкт 📦", callback_data: "proj:main" },
        { text: "Памʼять 🗂", callback_data: "mem:main" },
      ],
    ],
  };
}

function buildDriveKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Зберегти файл", callback_data: "drive:save" },
        { text: "Режим", callback_data: "drive:mode" },
      ],
      [{ text: "Відкрити Диск", url: "https://drive.google.com" }],
    ],
  };
}

function buildCodexKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "Вкл/Викл Codex", callback_data: "codex:toggle" }],
      [{ text: "Показати чергу", callback_data: "codex:queue" }],
      [{ text: "Очистити памʼять", callback_data: "codex:clear" }],
    ],
  };
}
async function handleDriveSave(env, chatId, userId, msg) {
  const doc = pickDocument(msg) || pickPhoto(msg);
  if (!doc) {
    await reply(env, chatId, "Не бачу файлу у повідомленні 📎");
    return;
  }
  const fileUrl = abs(env.API_BASE, `/file/${doc.file_id}`);
  const name = doc.file_name || getFileNameFromUrl(fileUrl);
  const tokens = await getUserTokens(env, userId);
  if (!tokens) {
    await reply(env, chatId, "Немає токенів Google Drive. Додай у налаштуваннях.");
    return;
  }
  const res = await driveSaveFromUrl(env, tokens, fileUrl, name);
  if (res?.id) {
    await reply(env, chatId, `✅ Збережено у Drive як ${name}`, {
      reply_markup: buildDriveKeyboard(),
    });
  } else {
    await reply(env, chatId, "Не вдалось зберегти у Drive ❗️");
  }
}

async function handleDriveModeToggle(env, chatId, userId) {
  const m = await getDriveMode(env, userId);
  const next = m === "auto" ? "manual" : "auto";
  await setDriveMode(env, userId, next);
  await reply(env, chatId, `Режим Drive: ${next}`);
}

// vision-mode
async function handleVisionMedia(env, chatId, userId, msg, lang, caption) {
  const att = pickPhoto(msg);
  if (!att) return false;

  // тут можна одразу витягувати/розпізнавати код зі скріну
  // поки що просто збережемо "ост. медіа" + дамо інструкцію
  const visionState = {
    ts: Date.now(),
    file_id: att.file_id,
    caption: caption || "",
  };
  await saveVisionMem(env, userId, visionState);

  await reply(
    env,
    chatId,
    "📸 Я отримав скрін/фото. Можу: \n• витягнути код\n• сказати, що там не так\n• переписати в чистий вигляд\n\nНапиши коротко: «проаналізуй», «перепиши», «знайди помилки», «зроби файл».",
    {
      reply_markup: buildInlineKeyboard([
        [{ text: "Проаналізуй", callback_data: "vision:analyze" }],
        [{ text: "Перепиши в код", callback_data: "vision:to-code" }],
      ]),
    }
  );
  return true;
}

async function handleVisionAction(env, chatId, userId, action) {
  const mem = await loadVisionMem(env, userId);
  if (!mem) {
    await reply(env, chatId, "Немає останнього зображення для аналізу.");
    return;
  }
  // тут ти пізніше підʼєднаєш свою віжн-функцію
  await reply(
    env,
    chatId,
    `🔎 Запит: ${action}.\nПоки що я лише памʼятаю, що ти скинув: ${mem.caption || "без підпису"}.`
  );
}

// Codex queue UI
async function showCodexQueue(env, chatId, userId) {
  const q = await listQueued(env, userId);
  if (!q || !q.length) {
    await reply(env, chatId, "Черга Codex порожня.", {
      reply_markup: buildCodexKeyboard(),
    });
    return;
  }
  const text =
    "🗂 Черга Codex:\n" +
    q
      .map(
        (item, idx) =>
          `${idx + 1}. ${item.name || "без назви"} — ${item.lang || "text"}`
      )
      .join("\n");
  await reply(env, chatId, text, { reply_markup: buildCodexKeyboard() });
}

async function clearCodexMem(env, userId) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  try {
    await kv.delete(CODEX_MEM_KEY(userId));
  } catch {}
}
async function processTextCommand(env, chatId, userId, text, lang) {
  const lower = text.trim().toLowerCase();

  if (lower === "senti" || lower === "/start") {
    await reply(env, chatId, "Слухаю 👋", {
      reply_markup: buildMainKeyboard(lang),
    });
    return true;
  }

  if (lower === "codex" || lower === "кодекс") {
    await reply(env, chatId, "Codex режим ⚙️", {
      reply_markup: buildCodexKeyboard(),
    });
    return true;
  }

  if (lower === "drive") {
    await reply(env, chatId, "Google Drive 📁", {
      reply_markup: buildDriveKeyboard(),
    });
    return true;
  }

  if (lower === "проект" || lower === "проєкт") {
    const proj = await getCurrentProject(env, userId);
    await reply(env, chatId, `Поточний проєкт: ${proj}`);
    return true;
  }

  if (lower.startsWith("проєкт ")) {
    const name = lower.substring("проєкт ".length).trim();
    if (name) {
      await setCurrentProject(env, userId, name);
      await reply(env, chatId, `✅ Проєкт змінено на: ${name}`);
    }
    return true;
  }

  return false;
}

// callback handler
async function handleCallback(env, update) {
  const { chat_id, user_id, data, message_id } = parseTgMessage(update, true);
  const lang = pickReplyLanguage(update);

  if (!data) return;

  if (data === "drive:save") {
    await reply(env, chat_id, "Надішли файл або фото, яке зберегти у Drive.");
    return;
  }
  if (data === "drive:mode") {
    await handleDriveModeToggle(env, chat_id, user_id);
    return;
  }

  if (data === "codex:main") {
    await editMessageText(env, chat_id, message_id, "Codex ⚙️", {
      reply_markup: buildCodexKeyboard(),
    });
    return;
  }
  if (data === "codex:toggle") {
    const current = await isCodexMode(env, user_id);
    await setCodexMode(env, user_id, !current);
    await editMessageText(
      env,
      chat_id,
      message_id,
      `Codex: ${!current ? "ввімкнено" : "вимкнено"}`,
      { reply_markup: buildCodexKeyboard() }
    );
    return;
  }
  if (data === "codex:queue") {
    await showCodexQueue(env, chat_id, user_id);
    return;
  }
  if (data === "codex:clear") {
    await clearCodexMem(env, user_id);
    await reply(env, chat_id, "🧹 Памʼять Codex очищено.");
    return;
  }

  if (data === "vision:analyze") {
    await handleVisionAction(env, chat_id, user_id, "analyze");
    return;
  }
  if (data === "vision:to-code") {
    await handleVisionAction(env, chat_id, user_id, "to-code");
    return;
  }

  // fallback
  await answerCallback(env, update, "ok");
}

// головний webhook
export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return json({ ok: true, ts: Date.now() });
    }

    const update = await request.json();
    const lang = pickReplyLanguage(update);
    const { chat_id, user_id, text, is_callback, message } =
      parseTgMessage(update);

    if (is_callback) {
      await handleCallback(env, update);
      return json({ ok: true });
    }

    // якщо це медіа (фото) — пробуємо в vision
    if (message && (message.photo || message.document) && !text) {
      const handled = await handleVisionMedia(
        env,
        chat_id,
        user_id,
        message,
        lang,
        message.caption
      );
      if (handled) return json({ ok: true });
    }

    // команди-тригери
    const known = text
      ? await processTextCommand(env, chat_id, user_id, text, lang)
      : false;
    if (known) return json({ ok: true });

    // якщо codex режим — шлемо в learn/codex
    const codexOn = await isCodexMode(env, user_id);
    if (codexOn && text) {
      await enqueueLearn(env, user_id, {
        name: "tg-text",
        lang: "text",
        content: text,
        ts: Date.now(),
      });
      await reply(
        env,
        chat_id,
        "Прийняв у Codex. Можу показати чергу або сформувати файл.",
        { reply_markup: buildCodexKeyboard() }
      );
      return json({ ok: true });
    }

    // дефолтна відповідь — інтент/brain
    if (text) {
      const energy = await getEnergy(env, user_id);
      if (!energy || energy < 1) {
        await reply(env, chat_id, "🔋 Недостатньо енергії.");
        return json({ ok: true });
      }
      await spendEnergy(env, user_id, 1);

      const dialogHint = await buildDialogHint(env, user_id, text);
      const stat = await readStatut(env);
      const answer = await askAnyModel(env, user_id, {
        text,
        dialog: dialogHint,
        statut: stat,
      });
      if (answer) {
        await reply(env, chat_id, answer);
        await pushTurn(env, user_id, { from: "user", text });
        await pushTurn(env, user_id, { from: "bot", text: answer });
      } else {
        await reply(env, chat_id, "Не зміг відповісти.");
      }
    }

    return json({ ok: true });
  },
};
