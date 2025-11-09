// src/routes/webhook.js
// (rev) мультимовність з Telegram, Gemini — перший для vision,
// admin має checklist + energy + learn, тихе перемикання режимів,
// learn-тумблери, погода, дата/час, drive/vision роутинг.
// (upd) Codex-режим для задач по коду/ботах/лендінгах.
// (upd) vision → gemini-2.5-flash.
// (upd) /codex_template … → віддаємо готові файли.
// (upd) vision follow-up по останньому фото + клавіатура + розбиття

import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { think } from "../lib/brain.js";
import { readStatut } from "../lib/kvChecklist.js";
import { askAnyModel, getAiHealthSummary } from "../lib/modelRouter.js";
import { json } from "../utils/http.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { buildDialogHint, pushTurn } from "../lib/dialogMemory.js";
import { loadSelfTune, autoUpdateSelfTune } from "../lib/selfTune.js";
import { setDriveMode, getDriveMode } from "../lib/driveMode.js";
import { t, pickReplyLanguage } from "../lib/i18n.js";
import { TG } from "../lib/tg.js";
import {
  enqueueLearn,
  listQueued,
  getRecentInsights,
  setLearnMode,
  getLearnMode,
} from "../lib/learn.js";
import {
  weatherSummaryByPlace,
  weatherSummaryByCoords,
  getUserLocation,
} from "../lib/weather.js";
import { replyCurrentDate, replyCurrentTime } from "../lib/datetime.js";
import { buildVisionHintByLang, postprocessVisionText } from "../flows/visionPolicy.js";
import { rememberVisionForUser, answerVisionFollowup } from "../lib/visionMem.js";

const BTN_GOOGLE_DRIVE = "Google Drive";
const BTN_SENTI = "Senti";
const BTN_ADMIN = "Admin";
const BTN_CODEX = "Codex";
// кнопки вгорі чату
function mainKeyboard(isAdmin = false) {
  const base = [
    [{ text: BTN_GOOGLE_DRIVE }, { text: BTN_SENTI }],
    [{ text: BTN_CODEX }],
  ];
  if (isAdmin) {
    base.push([{ text: BTN_ADMIN }]);
  }
  return {
    keyboard: base,
    resize_keyboard: true,
  };
}

// KV ключі
const KV_KEYS = {
  lastPhoto: (uid) => `tg:lastPhoto:${uid}`,
  dialog: (uid) => `tg:dialog:${uid}`,
  codexMode: (uid) => `codex:mode:${uid}`,
};

// vision-пам’ять (останнi 20)
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
async function saveVisionMem(env, userId, memArr) {
  try {
    await (env.STATE_KV || env.CHECKLIST_KV)?.put(
      VISION_MEM_KEY(userId),
      JSON.stringify(memArr.slice(-20))
    );
  } catch {}
}
// ============================================================================
// доп. утиліти для TG
async function sendPlain(env, chatId, text, extra = {}) {
  const body = {
    chat_id: chatId,
    text,
    ...extra,
  };
  await fetch(abs(env, `/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function sendTyping(env, chatId) {
  try {
    await fetch(abs(env, `/bot${env.TELEGRAM_BOT_TOKEN}/sendChatAction`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
  } catch {}
}
function pulseTyping(env, chatId, times = 4, intervalMs = 4000) {
  sendTyping(env, chatId);
  for (let i = 1; i < times; i++)
    setTimeout(() => sendTyping(env, chatId), i * intervalMs);
}

// base64 з TG
async function urlToBase64(url) {
  const r = await fetch(url);
  const ab = await r.arrayBuffer();
  const b64 = btoa(
    String.fromCharCode.apply(null, [...new Uint8Array(ab)])
  );
  return `data:image/jpeg;base64,${b64}`;
}
// збереження останнього фото
async function rememberLastPhoto(env, userId, fileId) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  await kv.put(KV_KEYS.lastPhoto(userId), fileId, { expirationTtl: 60 * 60 * 3 });
}
async function getLastPhoto(env, userId) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return null;
  return await kv.get(KV_KEYS.lastPhoto(userId), "text");
}

// ---------------------------------------------------------------------------
// vision-хендлер (gemini-2.5-flash першим)
async function handleVision(env, imageBase64, userQuestion, lang) {
  const sys = buildVisionHintByLang(lang);
  const user = userQuestion
    ? `Користувач питає: "${userQuestion}"`
    : "Опиши зображення лаконічно, без дублювань, дотримуйся формату.";
  const res = await askAnyModel(env, {
    task: "vision",
    system: sys,
    user,
    image_base64: imageBase64,
    prefer: ["gemini:gemini-2.5-flash", "cf:@cf/meta/llama-3.2-11b-instruct"],
  });
  const txt = postprocessVisionText(res?.text || "");
  return txt || "Не вдалося описати зображення.";
}
// медіа з tg
async function handleIncomingMedia(env, update, lang, isAdmin) {
  const msg = update.message;
  const chatId = msg.chat.id;
  const fromId = msg.from.id;

  const photo = msg.photo?.[msg.photo.length - 1];
  if (!photo) return;

  // запам’ятати фото
  await rememberLastPhoto(env, fromId, photo.file_id);
  await saveVisionMem(env, fromId, [
    ...(await loadVisionMem(env, fromId)),
    { file_id: photo.file_id, at: Date.now() },
  ]);

  // якщо увімкнено learn — закидуємо в чергу й не описуємо
  const learnOn = await getLearnMode(env, fromId);
  if (learnOn) {
    await enqueueLearn(env, fromId, {
      kind: "tg_photo",
      file_id: photo.file_id,
      caption: msg.caption || "",
      at: Date.now(),
    });
    await sendPlain(env, chatId, "🧠 Фото додано в чергу Learn.");
    return;
  }

  // отримати лінк
  const fileInfo = await fetch(
    abs(env, `/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${photo.file_id}`)
  ).then((r) => r.json());
  const fileUrl = abs(
    env,
    `/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileInfo.result.file_path}`
  );
  const imageBase64 = await urlToBase64(fileUrl);
  const visionAns = await handleVision(env, imageBase64, "", lang);

  await sendPlain(env, chatId, visionAns, {
    reply_markup: mainKeyboard(isAdmin),
  });
}
// відповіді на допитування по фото
async function handleVisionFollowup(env, update, lang, isAdmin) {
  const msg = update.message;
  const chatId = msg.chat.id;
  const fromId = msg.from.id;
  const textRaw = msg.text?.trim() || "";

  const lastPhotos = await loadVisionMem(env, fromId);
  const lastOne = lastPhotos[lastPhotos.length - 1];
  if (!lastOne) {
    await sendPlain(env, chatId, "Немає останнього фото для уточнення.");
    return;
  }

  const fileInfo = await fetch(
    abs(env, `/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${lastOne.file_id}`)
  ).then((r) => r.json());
  const fileUrl = abs(
    env,
    `/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileInfo.result.file_path}`
  );
  const imageBase64 = await urlToBase64(fileUrl);
  const visionAns = await handleVision(env, imageBase64, textRaw, lang);

  await sendPlain(env, chatId, visionAns, {
    reply_markup: mainKeyboard(isAdmin),
  });
}
// режим Codex (tg-кнопка)
async function setCodexMode(env, userId, on = true) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  await kv.put(KV_KEYS.codexMode(userId), on ? "on" : "off", { expirationTtl: 60 * 60 * 24 * 3 });
}
async function getCodexMode(env, userId) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return false;
  return (await kv.get(KV_KEYS.codexMode(userId), "text")) === "on";
}
export async function handleTelegramWebhook(req, env) {
  const url = new URL(req.url);

  // --- public GET endpoints for admin & codex ---
  if (req.method === "GET") {
    const u = url.searchParams.get("u") || url.searchParams.get("user") || "";

    // /admin/energy
    if (url.pathname === "/admin/energy") {
      const isAdmin = TG.ADMIN(env, u, null);
      if (!isAdmin) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
      const energy = await getEnergy(env, u);
      const html = `<!doctype html>
<html lang="uk"><head>
<meta charset="utf-8" />
<title>Senti energy</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
body{background:#020617;color:#e2e8f0;font-family:system-ui,Arial,sans-serif;padding:16px}
.card{background:#111827;border-radius:12px;padding:16px;max-width:460px;margin:0 auto}
h1{margin-top:0}
code{background:rgba(15,23,42,.35);padding:2px 6px;border-radius:6px}
</style>
</head>
<body>
<div class="card">
<h1>⚡ Енергія Senti</h1>
<p>ID: <code>${u}</code></p>
<p>Поточна енергія: <strong>${energy?.energy ?? 0}</strong></p>
<p>Денний ліміт: <strong>${energy?.limit ?? "—"}</strong></p>
<p style="font-size:.75rem;opacity:.6;margin-top:12px">Цю сторінку бачиш тільки ти (адмін).</p>
</div>
</body></html>`;
      return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
// /admin/learn
    if (url.pathname === "/admin/learn") {
      const isAdmin = TG.ADMIN(env, u, null);
      if (!isAdmin) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
      const on =
        (await (env.STATE_KV || env.CHECKLIST_KV).get(`learn:mode:${u}`)) === "on";
      const html = `<!doctype html>
<html lang="uk"><head>
<meta charset="utf-8" />
<title>Senti Learn</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
body{background:#020617;color:#e2e8f0;font-family:system-ui,Arial,sans-serif;padding:16px}
.card{background:#111827;border-radius:12px;padding:16px;max-width:460px;margin:0 auto}
h1{margin-top:0}
</style>
</head>
<body>
<div class="card">
<h1>🧠 Режим Learn</h1>
<p>Статус: <strong style="color:${on ? "#22c55e" : "#f97316"}">${on ? "УВІМКНЕНО" : "ВИМКНЕНО"}</strong></p>
<p style="font-size:.75rem;opacity:.6;margin-top:12px">Якщо увімкнено — усі посилання/файли йдуть у чергу.</p>
</div>
</body></html>`;
      return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // /codex/demo/html — щоб отримати готовий html і зберегти з телефона
    if (url.pathname === "/codex/demo/html") {
      const isAdmin = TG.ADMIN(env, u, null);
      if (!isAdmin) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
      const html = `<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Senti Codex demo</title>
  <style>
    body{font-family:system-ui,Arial,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:20px}
    .box{background:#111827;border-radius:16px;padding:16px;max-width:760px;margin:0 auto}
  </style>
</head>
<body>
  <div class="box">
    <h1>Привіт з Senti Codex 👋</h1>
    <p>Це демо-HTML, який воркер віддає напряму. Можеш зберегти як <code>index.html</code> з телефона.</p>
  </div>
</body>
</html>`;
      return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // дефолт GET
    return json({ ok: true, note: "webhook alive (GET)" });
  }
if (req.method === "POST") {
    const sec = req.headers.get("x-telegram-bot-api-secret-token");
    const expected =
      env.TG_WEBHOOK_SECRET ||
      env.TELEGRAM_SECRET_TOKEN ||
      env.WEBHOOK_SECRET ||
      "";
    if (expected && sec !== expected) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
  } else {
    // теоретично не зайдемо, бо GET уже обробили вище
  }

  let update;
  try {
    update = await req.json();
  } catch (e) {
    return json({ ok: false, error: "invalid json" }, 400);
  }

  const msg = update.message || update.edited_message;
  if (!msg) {
    return json({ ok: true, note: "no message" });
  }
const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || "";
  const isAdmin = TG.ADMIN(env, userId, username);

  // вибір мови
  const lang = pickReplyLanguage(msg.from.language_code, msg.text);

  // медіа?
  if (msg.photo && !msg.text) {
    await handleIncomingMedia(env, update, lang, isAdmin);
    return json({ ok: true });
  }

  const textRaw = (msg.text || msg.caption || "").trim();

  // follow-up по фото
  if (/^(що|де|коли|якого|кого|які|яка|який)\b/i.test(textRaw)) {
    const talkedAboutPhoto = await answerVisionFollowup(
      env,
      userId,
      textRaw,
      lang
    );
    if (talkedAboutPhoto) {
      await sendPlain(env, chatId, talkedAboutPhoto, {
        reply_markup: mainKeyboard(isAdmin),
      });
      return json({ ok: true });
    }
  }
// /admin з кнопок
  if (isAdmin && (textRaw === "/admin" || textRaw === "Admin")) {
    const aiHealth = await getAiHealthSummary(env);
    const panel =
      "Admin panel (quick diagnostics):\n" +
      `MODEL_ORDER: ${aiHealth.model_order}\n` +
      `GEMINI key: ${aiHealth.gemini ? "✅" : "❌"}\n` +
      `Cloudflare: ${aiHealth.cf ? "✅" : "❌"}\n` +
      `OpenRouter: ${aiHealth.openrouter ? "✅" : "❌"}\n` +
      `FreeLLM: ${aiHealth.free ? "✅" : "❌"}\n\n` +
      "— Health:\n" +
      aiHealth.healthText;

    await sendPlain(env, chatId, panel, {
      reply_markup: {
        keyboard: [
          [{ text: "📋 Checklist" }],
          [{ text: "⚡ Energy" }],
          [{ text: "🧠 Learn" }],
          [{ text: BTN_SENTI }],
        ],
        resize_keyboard: true,
      },
      parse_mode: "Markdown",
    });
    return json({ ok: true });
  }
// адмінські підкнопки
  if (isAdmin && textRaw === "⚡ Energy") {
    const energy = await getEnergy(env, userId);
    await sendPlain(
      env,
      chatId,
      `⚡ Енергія: ${energy.energy}/${energy.limit}\n(дивись також воркер /admin/energy?u=${userId})`,
      { reply_markup: mainKeyboard(isAdmin) }
    );
    return json({ ok: true });
  }
  if (isAdmin && textRaw === "🧠 Learn") {
    const learnOn = await getLearnMode(env, userId);
    const queued = await listQueued(env, userId);
    const insights = await getRecentInsights(env, userId);
    let ans = `🧠 Learn-режим: ${learnOn ? "УВІМКНЕНО" : "ВИМКНЕНО"}\n`;
    ans += `У черзі: ${queued.length}\n`;
    if (insights.length) {
      ans += "\nОстанні витяги:\n";
      for (const it of insights.slice(0, 5)) {
        ans += `• ${it.title}\n`;
      }
    }
    ans += `\n(дивись також воркер /admin/learn?u=${userId})`;
    await sendPlain(env, chatId, ans, {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }
// чеклист
  if (isAdmin && textRaw === "📋 Checklist") {
    const statut = await readStatut(env);
    await sendPlain(env, chatId, statut, {
      parse_mode: "HTML",
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }

  // вмикаємо/вимикаємо learn командами
  if (isAdmin && textRaw === "/learn_on") {
    await setLearnMode(env, userId, true);
    await sendPlain(
      env,
      chatId,
      "🟢 Learn-режим увімкнено. Посилання та файли будуть у черзі."
    );
    return json({ ok: true });
  }
  if (isAdmin && textRaw === "/learn_off") {
    await setLearnMode(env, userId, false);
    await sendPlain(
      env,
      chatId,
      "🔴 Learn-режим вимкнено. Медіа знову працюють як раніше."
    );
    return json({ ok: true });
  }
// тихі перемикачі
  if (textRaw === BTN_GOOGLE_DRIVE || /^(google\s*drive)$/i.test(textRaw)) {
    await setDriveMode(env, userId, true);
    return json({ ok: true });
  }
  if (textRaw === BTN_SENTI || /^(senti|сенті)$/i.test(textRaw)) {
    await setDriveMode(env, userId, false);
    await setCodexMode(env, userId, false);
    return json({ ok: true });
  }

  // codex тільки для адміна
  if (isAdmin && (textRaw === BTN_CODEX || textRaw === "/codex_on")) {
    await setCodexMode(env, userId, true);
    await sendPlain(
      env,
      chatId,
      "🧠 Senti Codex увімкнено. Надішли завдання.",
      { reply_markup: mainKeyboard(isAdmin) }
    );
    return json({ ok: true });
  }
  if (isAdmin && textRaw === "/codex_off") {
    await setCodexMode(env, userId, false);
    await sendPlain(env, chatId, "Codex вимкнено.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }
// якщо Codex увімкнено — весь текст сюди
  const codexOn = await getCodexMode(env, userId);
  if (codexOn && textRaw && !textRaw.startsWith("/")) {
    // тут можна ще зробити роутер "зроби html і дай посилання", але ти вже маєш GET
    const res = await askAnyModel(env, {
      task: "code",
      user: textRaw,
      system:
        "Ти Senti Codex. Генеруй повні файли. Якщо це HTML — давай повний <html>…</html>. Пояснення короткі.",
      prefer: ["gemini:gemini-2.5-flash", "cf:@cf/meta/llama-3.2-11b-instruct"],
    });
    await sendPlain(env, chatId, res?.text || "Не вдалося згенерувати код.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }
// звичайний текст: дата, погода, час
  if (textRaw) {
    const wantsDate = /дата|сьогодні/i.test(textRaw);
    const wantsTime = /час|котра/i.test(textRaw);
    const wantsWeather = /погода|weather/i.test(textRaw);

    if (wantsDate) await sendPlain(env, chatId, replyCurrentDate(env, lang));
    if (wantsTime) await sendPlain(env, chatId, replyCurrentTime(env, lang));

    if (wantsWeather) {
      const byPlace = await weatherSummaryByPlace(env, textRaw, lang);
      const notFound = /Не вдалося знайти такий населений пункт\./.test(
        byPlace.text
      );
      if (!notFound) {
        await sendPlain(env, chatId, byPlace.text, {
          parse_mode: byPlace.mode || undefined,
        });
      } else {
        const geo = await getUserLocation(env, userId);
        if (geo?.lat && geo?.lon) {
          const byCoords = await weatherSummaryByCoords(
            geo.lat,
            geo.lon,
            lang
          );
          await sendPlain(env, chatId, byCoords.text, {
            parse_mode: byCoords.mode || undefined,
          });
        } else {
          await sendPlain(
            env,
            chatId,
            "Не знайшов погоду (немає локації).",
            { reply_markup: mainKeyboard(isAdmin) }
          );
        }
      }
      return json({ ok: true });
    }
  }
// дефолт
  await sendPlain(
    env,
    chatId,
    `${t(lang, "hello_name", msg?.from?.first_name || "друже")} ${t(
      lang,
      "how_help"
    )}`,
    { reply_markup: mainKeyboard(isAdmin) }
  );
  return json({ ok: true });
}