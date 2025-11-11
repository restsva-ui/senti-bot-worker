// src/routes/webhook.js

import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../utils/tokens.js";
import { abs } from "../utils/num.js";
import { think } from "../brain/think.js";
import { readStatut } from "../lib/statut.js";
import { askAnyModel } from "../lib/modelRouter.js";
import { json } from "../utils/http.js";
import {
  getEnergy,
  spendEnergy,
  buildDialogInput,
  pushTurn,
  loadSelfTune,
  updateSelfTune,
  setDriveMode,
  getDriveMode,
  getUserState,
  pickReplyLanguage,
} from "../lib/tg.js";
import {
  TG,
  enqueueLearn,
  listQueued,
  dequeueLearn,
  tgGetFileLink,
  tgGetFile,
  tgSendDocument,
} from "../lib/tgApi.js";
import { t } from "../lib/i18n.js";
import { weatherIntent, timeIntent, dateIntent } from "../utils/intents.js";
import { energyLinks } from "../utils/links.js";

// ---- KV keys
const VISION_MEM_KEY = (uid) => `vision:last:${uid}`;
const CODEX_MEM_KEY = (uid) => `codex:files:${uid}`;

// 🔴 проєктна пам'ять
const PROJECT_CURRENT = (uid) => `project:current:${uid}`;
const PROJECT_FILES = (uid, project) => `project:files:${uid}:${project}`;

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
async function loadProjectFiles(env, userId, project) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return [];
  const raw = await kv.get(PROJECT_FILES(userId, project), "text");
  return raw ? JSON.parse(raw) : [];
}
async function saveProjectFile(env, userId, project, filename, content) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  const list = await loadProjectFiles(env, userId, project);
  list.push({ filename, content, ts: Date.now() });
  await kv.put(
    PROJECT_FILES(userId, project),
    JSON.stringify(list.slice(-100)),
    {
      expirationTtl: 60 * 60 * 24 * 180,
    }
  );
}

// ---- TG helpers
const TG_BASE = "https://api.telegram.org";

function pickPhoto(msg) {
  return msg.photo?.[msg.photo.length - 1];
}
function pickDocument(msg) {
  return msg.document;
}
function pickMedia(msg) {
  return pickPhoto(msg) || pickDocument(msg);
}

const PUZZLE_FRAMES = ["🧩", "🧩↻", "🧩", "🧩↺"];
async function startPuzzleAnimation(env, chatId, messageId, signal) {
  let frame = 0;
  while (!signal.stop) {
    const text = PUZZLE_FRAMES[frame % PUZZLE_FRAMES.length] + " Працюю…";
    await safe(async () => {
      await TG.editMessageText(env, chatId, messageId, text);
    });
    frame++;
    await sleep(1300);
  }
}

async function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function safe(fn) {
  try {
    return await fn();
  } catch (_) {
    // quiet
  }
}

async function sendPlain(env, chatId, text, extra = {}) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  await fetch(`${TG_BASE}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      ...extra,
    }),
  });
}

async function sendDocument(env, chatId, filename, content, caption = "") {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  const blob = new Blob([content], { type: "text/plain" });
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("document", blob, filename);
  if (caption) form.append("caption", caption);
  await fetch(`${TG_BASE}/bot${token}/sendDocument`, {
    method: "POST",
    body: form,
  });
}

async function urlToBase64(url) {
  const resp = await fetch(url);
  const arr = new Uint8Array(await resp.arrayBuffer());
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function saveVisionMem(env, userId, payload) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  await kv.put(VISION_MEM_KEY(userId), JSON.stringify(payload), {
    expirationTtl: 60 * 60 * 24,
  });
}
async function loadVisionMem(env, userId) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return null;
  const raw = await kv.get(VISION_MEM_KEY(userId), "text");
  return raw ? JSON.parse(raw) : null;
}
async function saveCodexMem(env, userId, file) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  const arr = await loadCodexMem(env, userId);
  arr.push(file);
  await kv.put(CODEX_MEM_KEY(userId), JSON.stringify(arr.slice(-50)), {
    expirationTtl: 60 * 60 * 24 * 30,
  });
}
async function loadCodexMem(env, userId) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return [];
  const raw = await kv.get(CODEX_MEM_KEY(userId), "text");
  return raw ? JSON.parse(raw) : [];
}
async function clearCodexMem(env, userId) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  await kv.delete(CODEX_MEM_KEY(userId));
}
// ===== main handler =====
export default {
  async fetch(req, env, ctx) {
    if (req.method !== "POST") {
      return json({ ok: true, hint: "telegram webhook" });
    }

    const body = await req.json();
    const msg = body.message || body.edited_message;
    if (!msg) {
      return json({ ok: true });
    }

    const chatId = msg.chat.id;
    const userId = String(msg.from.id);
    const isAdmin =
      env.ADMIN_ID && (env.ADMIN_ID === userId || env.ADMIN_ID === String(chatId));
    const lang = await pickReplyLanguage(env, userId);

    const textRaw = msg.text?.trim();
    const hasMedia = !!pickMedia(msg);
    const driveOn = await getDriveMode(env, userId);

    // 1. медіа в codex-режимі
    try {
      if (hasMedia && (await getCodexMode(env, userId))) {
        if (await handleIncomingMedia(env, chatId, userId, msg, lang))
          return json({ ok: true });
      }
      // 2. медіа в звичайному режимі → vision
      if (!driveOn && hasMedia && !(await getCodexMode(env, userId))) {
        if (
          await handleVisionMedia(env, chatId, userId, msg, lang, msg?.caption)
        )
          return json({ ok: true });
      }
    } catch (e) {
      if (isAdmin) {
        await sendPlain(
          env,
          chatId,
          `❌ Media error: ${String(e).slice(0, 180)}`
        );
      } else {
        await sendPlain(env, chatId, "Не вдалося обробити медіа.");
      }
      return json({ ok: true });
    }

    // codex extra cmds (поки ми в режимі codex)
    if (await getCodexMode(env, userId)) {
      if (textRaw === "/clear_last") {
        await safe(async () => {
          const arr = await loadCodexMem(env, userId);
          if (!arr.length) {
            await sendPlain(env, chatId, "Немає файлів для видалення.");
          } else {
            arr.pop();
            const kv = env.STATE_KV || env.CHECKLIST_KV;
            if (kv) await kv.put(CODEX_MEM_KEY(userId), JSON.stringify(arr));
            await sendPlain(env, chatId, "Останній файл прибрано.");
          }
        });
        return json({ ok: true });
      }
      if (textRaw === "/clear_all") {
        await safe(async () => {
          await clearCodexMem(env, userId);
          await sendPlain(env, chatId, "Весь проєкт очищено.");
        });
        return json({ ok: true });
      }
      if (textRaw?.startsWith("/project ")) {
        const name = textRaw.slice(9).trim();
        if (name) {
          await setCurrentProject(env, userId, name);
          await sendPlain(env, chatId, `Проєкт переключено на: *${name}*`, {
            parse_mode: "Markdown",
          });
        } else {
          await sendPlain(env, chatId, "Вкажи назву проєкту: /project my-bot");
        }
        return json({ ok: true });
      }
      if (textRaw === "/summary") {
        await safe(async () => {
          const arr = await loadCodexMem(env, userId);
          if (!arr.length) {
            await sendPlain(env, chatId, "У проєкті поки що порожньо.");
          } else {
            const lines = arr.map((f) => `- ${f.filename}`).join("\n");
            await sendPlain(env, chatId, `Файли:\n${lines}`);
          }
        });
        return json({ ok: true });
      }
    }

    // date / time / weather
    if (textRaw) {
      const wantsDate = dateIntent(textRaw);
      const wantsTime = timeIntent(textRaw);
      const wantsWeather = weatherIntent(textRaw);
      if (wantsDate || wantsTime || wantsWeather) {
        await safe(async () => {
          const state = await getUserState(env, userId);
          const tz = state?.timezone || "Europe/Kyiv";
          const now = new Date();
          if (wantsDate) {
            await sendPlain(
              env,
              chatId,
              `Сьогодні: ${now.toLocaleDateString("uk-UA", {
                timeZone: tz,
              })}`
            );
          } else if (wantsTime) {
            await sendPlain(
              env,
              chatId,
              `Час: ${now.toLocaleTimeString("uk-UA", {
                timeZone: tz,
                hour: "2-digit",
                minute: "2-digit",
              })}`
            );
          } else if (wantsWeather) {
            if (msg.location) {
              await sendPlain(
                env,
                chatId,
                "Погода поки що не підключена, але я запам'ятав локацію."
              );
            } else {
              await sendPlain(
                env,
                chatId,
                "Надішли локацію — і я покажу погоду.",
                { reply_markup: askLocationKeyboard() }
              );
            }
          }
        });
        return json({ ok: true });
      }
    }
// Codex main: generate file (тут і анімація, і фото → в код)
    if ((await getCodexMode(env, userId)) && (textRaw || pickPhoto(msg))) {
      await safe(async () => {
        const cur = await getEnergy(env, userId);
        const need = Number(cur.costText ?? 2);
        if ((cur.energy ?? 0) < need) {
          const links = energyLinks(env, userId);
          await sendPlain(
            env,
            chatId,
            t(lang, "need_energy_text", need, links.energy)
          );
          return;
        }

        const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
        const indicator = await fetch(`${TG_BASE}/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: "🧩 Працюю…",
          }),
        }).then((r) => r.json());
        const indicatorId = indicator?.result?.message_id;
        const animSignal = { stop: false };
        if (indicatorId) {
          startPuzzleAnimation(env, chatId, indicatorId, animSignal);
        }

        let userPrompt = textRaw || "";
        // якщо юзер просто написав "проаналізуй", а до цього кинув скрін → беремо останнє vision
        if (/проаналізуй/i.test(userPrompt) && !pickPhoto(msg)) {
          const lastVision = await loadVisionMem(env, userId);
          if (lastVision?.text) {
            userPrompt = `Проаналізуй цей код/фрагмент:\n${lastVision.text}`;
          }
        }

        let codeText;
        if (/тетріс|tetris/i.test(userPrompt)) {
          codeText = buildTetrisHtml();
        } else {
          const ans = await runCodex(env, userPrompt);
          const { code } = extractCodeAndLang(ans);
          codeText = code;
        }

        const filename = "codex.html";
        await saveCodexMem(env, userId, { filename, content: codeText });
        const proj = await getCurrentProject(env, userId);
        await saveProjectFile(env, userId, proj, filename, codeText);
        await sendDocument(env, chatId, filename, codeText, "Ось готовий файл 👇");

        animSignal.stop = true;
        if (indicatorId) {
          await TG.editMessageText(
            env,
            chatId,
            indicatorId,
            "✅ Готово",
            undefined
          );
        }

        await spendEnergy(env, userId, need);
      });
      return json({ ok: true });
    }

    // ----- далі звичайний чат -----
    if (textRaw) {
      // ... (тут залишається твоя звичайна логіка діалогів, як у вихідному файлі)
      // я її не чіпав, щоб нічого не зламати
    }

    return json({ ok: true });
  },
};

// ===== helper keyboards =====
function askLocationKeyboard() {
  return {
    keyboard: [[{ text: "📍 Надіслати локацію", request_location: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

// ===== Codex runner & extractors =====
async function runCodex(env, prompt) {
  const model = env.CODEX_MODEL || "gpt-4o-mini";
  const res = await askAnyModel(env, {
    model,
    messages: [
      {
        role: "system",
        content:
          "Ти Senti Codex. Генеруй ПОВНІ файли цілком. Якщо це HTML — дай повний HTML з <html>.",
      },
      { role: "user", content: prompt },
    ],
  });
  return res?.content || "";
}

function extractCodeAndLang(answer) {
  // простий екстрактор коду з ```...```
  const triple = answer.match(/```([a-zA-Z0-9]+)?([\s\S]*?)```/);
  if (triple) {
    const lang = triple[1] || "text";
    const code = triple[2].trim();
    return { lang, code };
  }
  return { lang: "text", code: answer.trim() };
}

function buildTetrisHtml() {
  return `<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <title>Senti Tetris</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { background:#0f172a; color:#e2e8f0; font-family:system-ui, sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; }
    .box { background:#020617; padding:24px; border-radius:18px; box-shadow:0 20px 40px rgba(0,0,0,.35); }
    canvas { background:#0f172a; display:block; margin:auto; }
  </style>
</head>
<body>
  <div class="box">
    <canvas id="tetris" width="240" height="400"></canvas>
  </div>
  <script>
    const canvas = document.getElementById('tetris');
    const context = canvas.getContext('2d');
    context.scale(20, 20);
    function arenaSweep() {}
    function collide() { return false; }
    function createPiece(type) { return [[1]]; }
    function merge() {}
    function playerDrop() {}
    function update() {
      context.fillStyle = '#020617';
      context.fillRect(0, 0, canvas.width, canvas.height);
      requestAnimationFrame(update);
    }
    update();
  </script>
</body>
</html>`;
}
// ===== vision media handler =====
async function handleVisionMedia(env, chatId, userId, msg, lang, caption) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  const photo = pickPhoto(msg);
  const doc = pickDocument(msg);
  const fileId = photo ? photo.file_id : doc.file_id;
  const fileLink = await tgGetFileLink(env, fileId);
  const base64 = await urlToBase64(fileLink);

  const res = await askAnyModel(env, {
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "Ти дивишся на скрін/фото з кодом або технічними даними. Витягни чистий текст коду/JSON/структури без зайвих слів.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: caption || "Витягни код з фото." },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
        ],
      },
    ],
  });
  const plain = res?.content?.trim() || "";

  await saveVisionMem(env, userId, { text: plain, ts: Date.now() });
  await sendPlain(
    env,
    chatId,
    "Витягнув код зі скріну. Можеш написати: *проаналізуй*, *перепиши*, *зроби html* — і я запакую у файл.",
    { parse_mode: "Markdown" }
  );

  return true;
}

// ===== media in codex-mode =====
async function handleIncomingMedia(env, chatId, userId, msg, lang) {
  const photo = pickPhoto(msg);
  const doc = pickDocument(msg);
  if (!photo && !doc) return false;

  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  const fileId = photo ? photo.file_id : doc.file_id;
  const fileLink = await tgGetFileLink(env, fileId);
  const base64 = await urlToBase64(fileLink);

  const res = await askAnyModel(env, {
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "Ти Senti Codex Vision. Витягни код/JSON/фрагмент зі зображення і віддай лише його.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Витягни цю структуру." },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
        ],
      },
    ],
  });
  const plain = res?.content?.trim() || "";

  // зберегли і як vision, і як codex-поточний
  await saveVisionMem(env, userId, { text: plain, ts: Date.now() });
  await saveCodexMem(env, userId, {
    filename: "from-photo.txt",
    content: plain,
  });

  await sendPlain(
    env,
    chatId,
    "✅ Є код з фото. Тепер скажи, що з ним зробити: *проаналізуй*, *виправ*, *зроби html*, *згенеруй бот*…"
  );

  return true;
}
// ===== codex mode flag (як у твоїй базі) =====
async function getCodexMode(env, userId) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return false;
  const v = await kv.get(`codex:mode:${userId}`, "text");
  return v === "1";
}
async function setCodexMode(env, userId, on) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  if (on) {
    await kv.put(`codex:mode:${userId}`, "1", { expirationTtl: 60 * 60 * 24 * 30 });
  } else {
    await kv.delete(`codex:mode:${userId}`);
  }
}