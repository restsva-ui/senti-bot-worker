// src/routes/webhook.js

// стабільний варіант: admin-кнопки одразу з URL, Codex шле тільки файл, є індикатор

import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { think } from "../lib/brain.js";
import { readStatut } from "../lib/kvChecklist.js";
import { askAnyModel, getAiHealthSummary } from "../lib/modelRouter.js";
import { json } from "../lib/utils.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { buildDialogHint, pushTurn } from "../lib/dialogMemory.js";
import { loadSelfTune, autoUpdateSelfTune } from "../lib/selfTune.js";
import { setDriveMode, getDriveMode } from "../lib/driveMode.js";
import { t, pickReplyLanguage } from "../lib/i18n.js";
import { TG } from "../lib/tg.js";

const {
  BTN_DRIVE,
  BTN_CODEX,
  BTN_SENTI,
  MAIN,
  ADMIN,
  energyLinks,
  sendPlain,
  askLocationKeyboard,
  mainKeyboard
} = TG;

const KV = {
  learnMode: (uid) => `learn:mode:${uid}`,
  codexMode: (uid) => `codex:mode:${uid}`,
  projectList: (uid) => `projects:${uid}`,
  currentProject: (uid) => `project:current:${uid}`,
  projectData: (uid, name) => `project:${uid}:${name}`
};

const VISION_MEM_KEY = (uid) => `vision:mem:${uid}`;

async function loadVisionMem(env, userId) {
  try {
    const raw = await (env.STATE_KV || env.CHECKLIST_KV)?.get(
      VISION_MEM_KEY(userId),
      "text"
    );
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
async function saveVisionMem(env, userId, entry) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  try {
    const arr = await loadVisionMem(env, userId);
    arr.push(entry);
    await kv.put(
      VISION_MEM_KEY(userId),
      JSON.stringify(arr)
    );
  } catch {}
}

// sendDocument — щоб Codex давав файл
async function sendDocument(env, chatId, filename, content, caption) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  if (!token) return;
  const fd = new FormData();
  fd.append("chat_id", String(chatId));
  const file = new File([content], filename, { type: "text/plain" });
  fd.append("document", file);
  if (caption) fd.append("caption", caption);
  await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: fd,
  });
}

async function getLearnMode(env, userId) {
  try {
    return (await env.STATE_KV.get(KV.learnMode(userId))) === "on";
  } catch {
    return false;
  }
}
async function setLearnMode(env, userId, on) {
  try {
    await env.STATE_KV.put(KV.learnMode(userId), on ? "on" : "off");
  } catch {}
}
async function runLearnNow(env) {
  const secret =
    env.WEBHOOK_SECRET ||
    env.TG_WEBHOOK_SECRET ||
    env.TELEGRAM_SECRET_TOKEN ||
    "";
  const u = new URL(abs(env, "/admin/learn/run"));
  if (secret) u.searchParams.set("s", secret);
  const r = await fetch(u.toString(), { method: "POST" });
  const ct = r.headers.get("content-type") || "";
  if (!r.ok) throw new Error(`learn_run http ${r.status}`);
  if (ct.includes("application/json")) return await r.json();
  return { ok: true, summary: await r.text() };
}

async function getProjects(env, userId) {
  try {
    const raw = await env.STATE_KV.get(KV.projectList(userId));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
async function saveProjects(env, userId, projects) {
  try {
    await env.STATE_KV.put(KV.projectList(userId), JSON.stringify(projects));
  } catch {}
}
async function getCurrentProject(env, userId) {
  try {
    return await env.STATE_KV.get(KV.currentProject(userId));
  } catch { return null; }
}
async function setCurrentProject(env, userId, name) {
  try {
    if (name) {
      await env.STATE_KV.put(KV.currentProject(userId), name);
    } else {
      await env.STATE_KV.delete(KV.currentProject(userId));
    }
  } catch {}
}
async function getProjectData(env, userId, name) {
  try {
    const raw = await env.STATE_KV.get(KV.projectData(userId, name));
    return raw ? JSON.parse(raw) : { entries: [] };
  } catch { return { entries: [] }; }
}
async function saveProjectData(env, userId, name, data) {
  try {
    await env.STATE_KV.put(KV.projectData(userId, name), JSON.stringify(data));
  } catch {}
}

// ... (rest of existing imports and code)

// ===== drive-mode =====
async function handleIncomingMedia(env, chatId, userId, msg, lang) {
  const att = detectAttachment(msg);
  if (!att) return false;

  let hasTokens = false;
  try {
    const tokens = await getUserTokens(env, userId);
    hasTokens = !!tokens;
  } catch {}
  if (!hasTokens) {
    const connectUrl = abs(env, "/auth/drive");
    await sendPlain(
      env,
      chatId,
      t(lang, "drive_connect_hint") ||
      "Щоб зберігати файли, підключи Google Drive.",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: t(lang, "open_drive_btn") || "Підключити Drive",
                url: connectUrl,
              },
            ],
          ],
        },
      }
    );
    return true;
  }

  const cur = await getEnergy(env, userId);
  const need = Number(cur.costImage ?? 5);
  if ((cur.energy ?? 0) < need) {
    const links = energyLinks(env, userId);
    await sendPlain(
      env,
      chatId,
      t(lang, "need_energy_media", need, links.energy)
    );
    return true;
  }
  await spendEnergy(env, userId, need, "media");

  const url = await tgFileUrl(env, att.file_id);
  const saved = await driveSaveFromUrl(env, userId, url, att.name);
  await sendPlain(
    env,
    chatId,
    `✅ ${t(lang, "saved_to_drive")}: ${saved?.name || att.name}`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: t(lang, "open_drive_btn"),
              url: "https://drive.google.com/drive/my-drive",
            },
          ],
        ],
      },
    }
  );
  return true;
}

// ===== vision-mode =====
async function handleVisionMedia(env, chatId, userId, msg, lang, caption) {
  const att = pickPhoto(msg);
  if (!att) return false;

  const cur = await getEnergy(env, userId);
  const need = Number(cur.costText ?? 1);
  if ((cur.energy ?? 0) < need) {
    const links = energyLinks(env, userId);
    await sendPlain(env, chatId, t(lang, "need_energy_text", need, links.energy));
    return true;
  }
  await spendEnergy(env, userId, need, "vision");

  pulseTyping(env, chatId);

  const url = await tgFileUrl(env, att.file_id);
  const imageBase64 = await urlToBase64(url);
  const prompt =
    caption ||
    (lang.startsWith("uk")
      ? "Опиши, що на зображенні, коротко і по суті."
      : "Describe the image briefly and to the point.");

  const visionOrder =
    "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-vision-instruct";

  try {
    const { text } = await describeImage(env, {
      chatId,
      tgLang: msg.from?.language_code,
      imageBase64,
      question: prompt,
      modelOrder: visionOrder,
    });

    await saveVisionMem(env, userId, {
      id: att.file_id,
      url,
      caption,
      desc: text,
    });

    // Якщо включений Codex і у запиті є "html", генеруємо HTML зі скріну
    if ((await getCodexMode(env, userId)) && caption && caption.toLowerCase().includes("html")) {
      const ans = await runCodex(env, `${caption}. Опис зображення: ${text}`);
      const { lang: codeLang, code } = extractCodeAndLang(ans);
      const fname = pickFilenameByLang(codeLang);
      await sendDocument(env, chatId, fname, code, "Ось HTML-сторінка за скріншотом 👇");
      return true;
    }

    await sendPlain(env, chatId, `🖼️ ${text}`);

    const landmarks = detectLandmarksFromText(text, lang);
    if (landmarks && landmarks.length) {
      const lines = formatLandmarkLines(landmarks, lang);
      await sendPlain(env, chatId, lines.join("\n"), {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    }
  } catch (e) {
    if (ADMIN(env, userId)) {
      await sendPlain(
        env,
        chatId,
        `❌ Vision error: ${String(e.message || e).slice(0, 180)}`
      );
    } else {
      const connectUrl = abs(env, "/auth/drive");
      await sendPlain(
        env,
        chatId,
        "Поки що не можу аналізувати фото. Можу зберегти його у Google Drive — натисни «Google Drive» або підключи Drive.",
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: t(lang, "open_drive_btn") || "Підключити Drive",
                  url: connectUrl,
                },
              ],
            ],
          },
        }
      );
    }
  }
  return true;
}

// ... (дальше код в основному блоці обробки повідомлень)
// ... (продовження файлу webhook.js)

// Обробка команд керування проектами
if (textRaw && textRaw.toLowerCase().startsWith("/project")) {
  const parts = textRaw.trim().split(" ");
  const cmd = parts[1] ? parts[1].toLowerCase() : "";
  const userProjects = await getProjects(env, userId);
  const current = await getCurrentProject(env, userId);

  if (cmd === "list") {
    if (!userProjects || userProjects.length === 0) {
      await sendPlain(env, chatId, "Немає жодного проекту.");
    } else {
      let text = "Проекти:\n";
      for (const p of userProjects) {
        text += ` - ${p}` + (current === p ? " (активний)" : "") + "\n";
      }
      await sendPlain(env, chatId, text.trim());
    }
    return json({ ok: true });
  }
  if (cmd === "new" && parts[2]) {
    const name = parts.slice(2).join(" ");
    if (userProjects.includes(name)) {
      await sendPlain(env, chatId, `Проект "${name}" вже існує.`);
    } else {
      userProjects.push(name);
      await saveProjects(env, userId, userProjects);
      await setCurrentProject(env, userId, name);
      await sendPlain(env, chatId, `Створено проект "${name}" і він активний.`);
    }
    return json({ ok: true });
  }
  if (cmd === "select" && parts[2]) {
    const name = parts.slice(2).join(" ");
    if (!userProjects.includes(name)) {
      await sendPlain(env, chatId, `Проект "${name}" не знайдено.`);
    } else {
      await setCurrentProject(env, userId, name);
      await sendPlain(env, chatId, `Проект "${name}" обрано.`);
    }
    return json({ ok: true });
  }
  if (cmd === "clear") {
    if (!current) {
      await sendPlain(env, chatId, "Немає обраного проекту для очищення.");
    } else {
      await saveProjectData(env, userId, current, { entries: [] });
      await sendPlain(env, chatId, `Пам'ять проекту "${current}" очищена.`);
    }
    return json({ ok: true });
  }
  if (cmd === "summary") {
    if (!current) {
      await sendPlain(env, chatId, "Немає обраного проекту для резюме.");
    } else {
      const data = await getProjectData(env, userId, current);
      if (!data.entries || data.entries.length === 0) {
        await sendPlain(env, chatId, "Проект порожній, немає даних для резюме.");
      } else {
        const prompt = data.entries.join("\n\n");
        const res = await askAnyModel(
          env,
          String(env.MODEL_ORDER || ""),
          `Резюмуй наступний проект:\n${prompt}`,
          { systemHint: "Ви допомагаєте підсумувати проект." }
        );
        const summary = typeof res === "string" ? res : (res.text || res);
        await sendPlain(env, chatId, summary);
      }
    }
    return json({ ok: true });
  }
}

// ... (далі стандартна обробка медіа/інших повідомлень)
// ... (далі webhook.js, обробка Codex та звичайних повідомлень)

// ===== Codex processing: send code file with indicator =====
if ((await getCodexMode(env, userId)) && textRaw) {
  await safe(async () => {
    const cur = await getEnergy(env, userId);
    const need = Number(cur.costText ?? 2);
    if ((cur.energy ?? 0) < need) {
      const links = energyLinks(env, userId);
      await sendPlain(env, chatId, t(lang, "need_energy_text", need, links.energy));
      return;
    }

    // Show "Working on code..." indicator
    const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
    let indicatorId = null;
    if (token) {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "🧩 Працюю над кодом…",
        }),
      });
      const d = await r.json().catch(() => null);
      indicatorId = d?.result?.message_id || null;
    }

    await spendEnergy(env, userId, need, "codex");
    pulseTyping(env, chatId);

    const ans = await runCodex(env, textRaw);
    await pushTurn(env, userId, "user", textRaw);
    await pushTurn(env, userId, "assistant", ans);

    const { lang: codeLang, code } = extractCodeAndLang(ans);
    const fname = pickFilenameByLang(codeLang);

    // Додаємо код до пам'яті поточного проекту
    const projectName = await getCurrentProject(env, userId);
    if (projectName) {
      const data = await getProjectData(env, userId, projectName);
      data.entries.push(code);
      await saveProjectData(env, userId, projectName, data);
    }

    // Відправляємо файл з кодом
    await sendDocument(env, chatId, fname, code, "Ось готовий файл 👇");
    await editMessageText(env, chatId, indicatorId, "✅ Готово");

    // Автоматичне навчання Codex, якщо увімкнено режим Learn
    if (await getLearnMode(env, userId)) {
      await runLearnNow(env);
    }
  });
  return json({ ok: true });
}

// ===== Звичайна обробка текстових повідомлень =====
// ... (інші інтенти, etc)
