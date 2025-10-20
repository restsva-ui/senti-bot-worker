// src/routes/webhook.js
import { json } from "../utils/http.js";
import {
  TG,
  BTN_DRIVE,
  BTN_SENTI,
  BTN_LEARN,
  BTN_ADMIN,
  mainKeyboard,
  ADMIN,
  sendPlain,
  energyLinks,
} from "../lib/tg.js";
import { pickLang, t } from "../lib/i18n.js";
import { enqueueLearn } from "../lib/kvLearnQueue.js";

/* ---------------- helpers ---------------- */

// Проста евристика визначення мови за текстом (не ламає i18n, лише підказує)
function detectLangFromText(s = "") {
  const txt = String(s || "");
  if (!txt) return null;
  // українська: специфічні літери
  if (/[ґҐєЄіІїЇ]/.test(txt)) return "uk";
  // кирилиця без укр-спецсимволів -> лишаємо на розсуд i18n (може бути ru)
  if (/[А-Яа-яЁёЪъЫыЭэ]/.test(txt)) return "uk";
  // німецька (дуже грубо)
  if (/[äöüßÄÖÜ]/.test(txt)) return "de";
  // англійська за відсутністю кирилиці
  if (/[A-Za-z]/.test(txt)) return "en";
  return null;
}

// Вибір мови: TG-профіль -> авто по тексту (якщо є) -> en
function getLangFromUpdate(update, textSample = "") {
  const base =
    update?.message?.from?.language_code ||
    update?.callback_query?.from?.language_code ||
    "en";
  const picked = pickLang(base);
  const auto = detectLangFromText(textSample);
  // якщо автодетектор дав щось відмінне — повертаємо його, інакше picked
  return pickLang(auto || picked || "en");
}

function getName(update) {
  return (
    update?.message?.from?.first_name ||
    update?.callback_query?.from?.first_name ||
    ""
  );
}

// Безпечний переклад із підстраховками: lang -> uk -> en -> key
function tt(lang, key, ...args) {
  const v1 = t(lang, key, ...args);
  if (v1 && v1 !== key) return v1;
  const v2 = t("uk", key, ...args);
  if (v2 && v2 !== key) return v2;
  const v3 = t("en", key, ...args);
  if (v3 && v3 !== key) return v3;
  return key;
}

// Підчищаємо "голий" URL у тексті (без крапок/дужок у кінці)
function extractUrl(s = "") {
  const m = String(s).match(/\bhttps?:\/\/[^\s<>]+/i);
  if (!m) return null;
  return m[0].replace(/[)\].,]+$/g, "");
}

/* ---------------- main handler ---------------- */

export async function handleTelegramWebhook(req, env) {
  const update = await req.json().catch(() => ({}));

  const chatId =
    update?.message?.chat?.id ??
    update?.callback_query?.message?.chat?.id ??
    null;
  if (!chatId) return json({ ok: true });

  const userId =
    update?.message?.from?.id ?? update?.callback_query?.from?.id ?? "";

  const rawText = (update?.message?.text || "").trim();
  const lang = getLangFromUpdate(update, rawText);
  const name = getName(update);

  // /start — привітання на мові акаунта/тексту
  if (/^\/start\b/i.test(rawText)) {
    await sendPlain(env, chatId, tt(lang, "hello", name), {
      reply_markup: mainKeyboard(ADMIN(env, userId)),
    });
    return json({ ok: true });
  }

  // ——— Кнопки клавіатури ———
  if (rawText === BTN_SENTI) {
    await sendPlain(env, chatId, tt(lang, "whoami"), {
      reply_markup: mainKeyboard(ADMIN(env, userId)),
    });
    return json({ ok: true });
  }

  if (rawText === BTN_LEARN) {
    await sendPlain(env, chatId, tt(lang, "learn_hint"), {
      reply_markup: mainKeyboard(ADMIN(env, userId)),
    });
    return json({ ok: true });
  }

  if (rawText === BTN_DRIVE) {
    const host = env.SERVICE_HOST || `${env.name}.workers.dev`;
    const link = `https://${host}/auth/start?u=${encodeURIComponent(
      String(userId)
    )}`;
    await sendPlain(
      env,
      chatId,
      `[↗️ ${tt(lang, "btn_open_drive") || "Open Drive"}](${link})`,
      {
        parse_mode: "Markdown",
        reply_markup: mainKeyboard(ADMIN(env, userId)),
      }
    );
    return json({ ok: true });
  }

  // ——— Адмінка ———
  if (rawText === BTN_ADMIN && ADMIN(env, userId)) {
    const { energy, checklist } = energyLinks(env, userId);
    const learnUrl = `https://${
      env.SERVICE_HOST || `${env.name}.workers.dev`
    }/admin/learn/html${
      env.WEBHOOK_SECRET
        ? `?s=${encodeURIComponent(env.WEBHOOK_SECRET)}&u=${encodeURIComponent(
            String(userId)
          )}`
        : ""
    }`;

    const kb = {
      inline_keyboard: [
        [{ text: tt(lang, "btn_open_checklist"), url: checklist }],
        [{ text: tt(lang, "btn_energy"), url: energy }],
        [{ text: tt(lang, "btn_learn"), url: learnUrl }],
      ],
    };

    await sendPlain(
      env,
      chatId,
      `${tt(lang, "admin_header")}\nMODEL_ORDER: ${
        env.MODEL_ORDER || "(not set)"
      }`,
      {
        reply_markup: kb,
        parse_mode: "HTML",
      }
    );
    return json({ ok: true });
  }

  // ——— Якщо користувач надіслав URL — додаємо у чергу навчання ———
  const url = extractUrl(rawText);
  if (url) {
    await enqueueLearn(env, String(userId), { url, name: url });
    await sendPlain(env, chatId, tt(lang, "learn_added"), {
      reply_markup: mainKeyboard(ADMIN(env, userId)),
    });
    return json({ ok: true });
  }

  // ——— Фолбек — підказка про Learn ———
  await sendPlain(env, chatId, tt(lang, "learn_hint"), {
    reply_markup: mainKeyboard(ADMIN(env, userId)),
  });
  return json({ ok: true });
}
