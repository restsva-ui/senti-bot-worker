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

// ─────────────────────────────────────────────────────────────────────────────
// Константи + допоміжні

const CODEX_MEM_KEY = (uid) => `codex:mem:${uid}`;
const CODEX_MODE_KEY = (uid) => `codex:mode:${uid}`;
const PROJ_CURR_KEY = (uid) => `codex:project:current:${uid}`;
const PROJ_PREFIX_META = (uid) => `codex:project:meta:${uid}:`;
const PROJ_PREFIX_FILE = (uid) => `codex:project:file:${uid}:`;
const UI_AWAIT_KEY = (uid) => `codex:await:${uid}`;

// inline-кнопки / callback_data
const CB = {
  NEW: "codex:new",
  LIST: "codex:list",
  USE: "codex:use",
  STATUS: "codex:status",
};

const CB_USE_PREFIX = "codex:use:";

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

// -------------------- вкл/викл Codex --------------------
export const CODEX_MEM_KEY_CONST = CODEX_MEM_KEY;

export async function setCodexMode(env, userId, on) {
  const kv = pickKV(env);
  if (!kv) return;
  await kv.put(CODEX_MODE_KEY(userId), on ? "true" : "false", {
    expirationTtl: 60 * 60 * 24 * 365,
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
  return (await kv.get(PROJ_CURR_KEY(userId), "text")) || null;
}
async function listProjects(env, userId) {
  const kv = pickKV(env);
  if (!kv || !kv.list) return [];
  const out = [];
  let cursor = undefined;
  do {
    const res = await kv.list({ prefix: PROJ_PREFIX_META(userId), cursor });
    for (const k of res.keys || []) {
      const parts = k.name.split(":"); // codex:project:meta:<uid>:<name>
      const name = parts.slice(-1)[0];
      if (name && !out.includes(name)) out.push(name);
    }
    cursor = res.cursor || null;
  } while (cursor);
  return out.sort();
}
async function readProjectMeta(env, userId, name) {
  const kv = pickKV(env);
  if (!kv) return null;
  const k = PROJ_PREFIX_META(userId) + name;
  const raw = await kv.get(k, "text");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function writeProjectMeta(env, userId, name, meta) {
  const kv = pickKV(env);
  if (!kv) return;
  const k = PROJ_PREFIX_META(userId) + name;
  const payload = JSON.stringify({
    ...meta,
    updated_at: nowIso(),
  });
  await kv.put(k, payload, { expirationTtl: 60 * 60 * 24 * 365 });
}
async function readSection(env, userId, projName, sectionName) {
  const kv = pickKV(env);
  if (!kv) return null;
  const k = PROJ_PREFIX_FILE(userId) + `${projName}:${sectionName}`;
  return (await kv.get(k, "text")) || null;
}
async function writeSection(env, userId, projName, sectionName, content) {
  const kv = pickKV(env);
  if (!kv) return;
  const k = PROJ_PREFIX_FILE(userId) + `${projName}:${sectionName}`;
  await kv.put(k, content, { expirationTtl: 60 * 60 * 24 * 365 });
}
async function appendSection(env, userId, projName, sectionName, line) {
  const prev = (await readSection(env, userId, projName, sectionName)) || "";
  const next = prev ? `${prev}\n${line}` : line;
  await writeSection(env, userId, projName, sectionName, next);
}

// -------------------- buildCodexKeyboard --------------------
export function buildCodexKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "➕ Створити проєкт", callback_data: CB.NEW }],
      [{ text: "📂 Обрати проєкт", callback_data: CB.USE }],
      [{ text: "📋 Статус", callback_data: CB.STATUS }],
    ],
  };
}

/**
 * handleCodexUi: обробляє callback_data з inline-меню.
 * helpers: { sendPlain, tgFileUrl, driveSaveFromUrl, getUserTokens }
 */
export async function handleCodexUi(env, chatId, userId, ctx, helpers) {
  const { cbData } = ctx;
  const { sendPlain, tgFileUrl, driveSaveFromUrl, getUserTokens } = helpers;
  const kv = pickKV(env);
  if (!kv) {
    await sendPlain(env, chatId, "Codex KV недоступний.");
    return false;
  }

  if (cbData === CB.NEW) {
    await kv.put(UI_AWAIT_KEY(userId), "proj_name", { expirationTtl: 3600 });
    await sendPlain(
      env,
      chatId,
      "Введи назву нового проєкту (одним рядком):",
      {
        reply_markup: {
          force_reply: true,
          input_field_placeholder: "Назва проєкту для Codex",
        },
      }
    );
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
    const buttons = all.slice(0, 25).map((name) => [{
      text: `📁 ${name}`,
      callback_data: CB_USE_PREFIX + encodeURIComponent(name).slice(0, 50),
    }]);
    await sendPlain(env, chatId, "Оберіть проєкт:", {
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
    return true;
  }

  if (cbData === CB.LIST) {
    const all = await listProjects(env, userId);
    if (!all.length) {
      await sendPlain(
        env,
        chatId,
        "Немає проєктів. Створи: /project new <name>"
      );
      return true;
    }
    const cur = await getCurrentProject(env, userId);
    const body = all
      .map((name) => (name === cur ? `👉 ${name} (active)` : `• ${name}`))
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
    await sendPlain(env, chatId, `Активний проєкт: ${name}`);
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

  // інші callback-и – ігноруємо
  return false;
}

// -------------------- handleCodexCommand (текстові /project команди) --------------------
async function handleCodexCommand(env, chatId, userId, textRaw, sendPlain) {
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
      await sendPlain(env, chatId, "Вкажи назву проєкту.");
      return true;
    }
    const metaPrev = await readProjectMeta(env, userId, name);
    if (metaPrev) {
      await sendPlain(
        env,
        chatId,
        `Проєкт "${name}" вже існує. Можеш його активувати /project use ${name}`
      );
      return true;
    }
    const base = {
      name,
      created_at: nowIso(),
      stage: "idea",
    };
    await writeProjectMeta(env, userId, name, base);
    await setCurrentProject(env, userId, name);
    if (idea) {
      await writeSection(env, userId, name, "idea.md", idea);
    }
    await sendPlain(
      env,
      chatId,
      `✅ Створено проєкт "${name}". Він активний.\n` +
        (idea
          ? "Ідея збережена в idea.md.\n"
          : "Додай ідею: /project idea set <текст>"),
    );
    return true;
  }

  // /project use <name>
  if (/^\/project\s+use\s+/i.test(txt)) {
    const m = txt.match(/^\/project\s+use\s+(.+)$/i);
    if (!m) return false;
    const name = m[1].trim();
    if (!name) {
      await sendPlain(env, chatId, "Вкажи назву проєкту.");
      return true;
    }
    const meta = await readProjectMeta(env, userId, name);
    if (!meta) {
      await sendPlain(env, chatId, `Проєкт "${name}" не знайдено.`);
      return true;
    }
    await setCurrentProject(env, userId, name);
    await sendPlain(env, chatId, `✅ Активний проєкт: "${name}".`);
    return true;
  }

  // /project list
  if (/^\/project\s+list/i.test(txt)) {
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
      .map((name) => (name === cur ? `👉 ${name} (active)` : `• ${name}`))
      .join("\n");
    await sendPlain(env, chatId, `Проєкти:\n${body}`);
    return true;
  }

  // /project idea set|append ...
  if (/^\/project\s+idea\s+/i.test(txt)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Спочатку активуй проєкт.");
      return true;
    }
    const m = txt.match(/^\/project\s+idea\s+(set|append)\s+([\s\S]+)$/i);
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

  // /project tasks add <line>
  if (/^\/project\s+tasks\s+/i.test(txt)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Спочатку активуй проєкт.");
      return true;
    }
    const m = txt.match(/^\/project\s+tasks\s+(add|done)\s+([\s\S]+)$/i);
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
    const prefix = action === "done" ? "[x] " : "[ ] ";
    await appendSection(env, userId, cur, "tasks.md", prefix + line);
    await sendPlain(env, chatId, "✅ Tasks оновлено.");
    return true;
  }

  // /project progress <line>
  if (/^\/project\s+progress\s+/i.test(txt)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Спочатку активуй проєкт.");
      return true;
    }
    const m = txt.match(/^\/project\s+progress\s+([\s\S]+)$/i);
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

  // /project snapshot -> export у Drive / zip
  if (/^\/project\s+snapshot/i.test(txt)) {
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

  // /project sync idea/progress/tasks -> Brain / Repo
  if (/^\/project\s+sync\s+/i.test(txt)) {
    const cur = await getCurrentProject(env, userId);
    if (!cur) {
      await sendPlain(env, chatId, "Спочатку активуй проєкт.");
      return true;
    }
    const m = txt.match(/^\/project\s+sync\s+(idea|progress|tasks)\b/i);
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
// -------------------- handleCodexGeneration --------------------
async function handleCodexGeneration(env, ctx, helpers) {
  const { chatId, userId, msg, textRaw, lang } = ctx;
  const { sendPlain, pickPhoto, tgFileUrl, urlToBase64 } = helpers;
  const kv = pickKV(env);

  // 0) UI-стани (force-reply): створення назви, вибір проєкту, набір ідеї
  const awaiting = (await kv.get(UI_AWAIT_KEY(userId), "text")) || "none";

  // Якщо користувач надіслав лише медіа без тексту і Codex не в режимі очікування
  // (не створюємо проєкт і не змінюємо ідею) — запитаємо, що зробити з фото/файлом.
  if (
    awaiting === "none" &&
    !textRaw &&
    msg &&
    (Array.isArray(msg.photo) && msg.photo.length > 0 || msg.document)
  ) {
    await sendPlain(
      env,
      chatId,
      "Я отримав медіа для Codex. Напиши, будь ласка, що саме зробити з цим фото/файлом (наприклад: «зроби логотип», «проаналізуй макет», «згенеруй код сторінки»)."
    );
    return true;
  }

  // нова назва проєкту
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
    const metaPrev = await readProjectMeta(env, userId, name);
    if (metaPrev) {
      await sendPlain(
        env,
        chatId,
        `Проєкт "${name}" вже існує. Обери іншу назву або користуйся існуючим.`
      );
      return true;
    }
    const base = {
      name,
      created_at: nowIso(),
      stage: "idea",
    };
    await writeProjectMeta(env, userId, name, base);
    await setCurrentProject(env, userId, name);
    await sendPlain(
      env,
      chatId,
      `✅ Створено проєкт "${name}". Тепер опиши ідею (я збережу її в idea.md).`
    );
    await kv.put(UI_AWAIT_KEY(userId), "idea_text", { expirationTtl: 3600 });
    return true;
  }

  // набір ідеї після створення проєкту (force-reply)
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

  // вибір проєкту по назві (старий режим через force-reply, лишаємо для сумісності)
  if (awaiting === "use_name" && textRaw) {
    await kv.delete(UI_AWAIT_KEY(userId));
    const name = textRaw.trim();
    if (!name) {
      await sendPlain(env, chatId, "Порожня назва. Спробуй ще раз.");
      return true;
    }
    const meta = await readProjectMeta(env, userId, name);
    if (!meta) {
      await sendPlain(env, chatId, `Проєкт "${name}" не знайдено.`);
      return true;
    }
    await setCurrentProject(env, userId, name);
    await sendPlain(env, chatId, `✅ Активний проєкт: "${name}".`);
    return true;
  }

  // якщо ми тут — жоден force-reply режим не активний
  const curName = await getCurrentProject(env, userId);
  if (!curName) {
    await sendPlain(
      env,
      chatId,
      "Немає активного проєкту. Натисни «Створити проєкт» або «Обрати проєкт»."
    );
    return true;
  }
  const projMeta = (await readProjectMeta(env, userId, curName)) || {
    name: curName,
  };

  // 1) Перевірка, чи це /project команда
  if (textRaw && textRaw.startsWith("/project")) {
    const handled = await handleCodexCommand(env, chatId, userId, textRaw, sendPlain);
    return handled;
  }

  // 2) Підготовка контексту проєкту (idea, tasks, progress)
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
    "",
    "Твої цілі:",
    "- допомагати проектувати архітектуру;",
    "- писати структурований, зрозумілий код;",
    "- пропонувати кроки розвитку проєкту (roadmap);",
    "- при потребі оновлювати tasks/progress (короткі записи, які можна скопіювати у /project tasks / progress).",
  ].join("\n");

  // 3) Обробка медіа (фото, документи) → assets
  const photo = pickPhoto ? pickPhoto(msg) : null;
  const doc = msg?.document || null;
  const voice = msg?.voice || null;
  const video = msg?.video || null;

  const saved = [];

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
      if (ok) saved.push(label);
    } catch {
      // ігноруємо конкретну помилку, просто не додаємо label
    }
  }

  if (photo?.file_id) {
    await handleAsset(
      photo.file_id,
      photo.name || `photo_${Date.now()}.jpg`,
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

  // для voice/video можна було б робити транскрипцію, але поки що просто ігноруємо як assets
let visionSummary = "";
  if (photo && urlToBase64) {
    try {
      const b64 = await urlToBase64(env, await tgFileUrl(env, photo.file_id));
      const visRes = await askVision(env, {
        imageBase64: b64,
        prompt:
          "Опиши, що на цьому зображенні, з фокусом на UI/UX, структуру, компоненти, шари. Не вигадуй код, просто дай структурований опис, корисний для розробника.",
      });
      if (typeof visRes === "string") {
        visionSummary = visRes;
      } else {
        const t =
          visRes?.choices?.[0]?.message?.content ||
          visRes?.text ||
          JSON.stringify(visRes);
        visionSummary = String(t || "").slice(0, 4000);
      }
    } catch {
      visionSummary = "";
    }
  }

  // 4) Підготовка промпта для моделі
  const userText = String(textRaw || "").trim();
  const parts = [];

  if (saved.length) {
    parts.push(
      `Assets, додані до проєкту: ${saved.join(
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
  } else if (!visionSummary && !saved.length) {
    // тут ми вже відсікли варіант "тільки медіа без тексту" вище
    parts.push(
      "Немає явного текстового запиту. Зроби невеликий огляд поточного стану проєкту та запропонуй наступні кроки."
    );
  }

  const finalUserPrompt = parts.join("\n\n").trim();

  // 5) Виклик LLM для генерації коду / архітектури / плану
  const order = env.MODEL_ORDER_CODE || env.MODEL_ORDER || env.MODEL_ORDER_TEXT;
  const res = await askAnyModel(env, order, finalUserPrompt || "Продовжуй", {
    systemHint,
    temperature: 0.2,
  });

  const outText =
    typeof res === "string"
      ? res
      : res?.choices?.[0]?.message?.content ||
        res?.text ||
        JSON.stringify(res);

  if (curName) {
    await appendSection(
      env,
      userId,
      curName,
      "progress.md",
      `[${nowIso()}] Codex: згенеровано відповідь на запит користувача.`
    );
  }

  const reply = [
    `📁 Проєкт: ${curName}`,
    "",
    outText || "(порожня відповідь від моделі)",
    "",
    "Можеш оновити Tasks/Progress командами /project tasks / /project progress.",
  ].join("\n");

  await sendPlain(env, chatId, reply);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Експорти
export {
  handleCodexCommand,
  handleCodexGeneration,
};