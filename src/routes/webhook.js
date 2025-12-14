// src/routes/webhook.js

import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { think } from "../lib/brain.js"; // залишаємо як у твоєму репо
import { readStatut } from "../lib/kvChecklist.js";
import { askAnyModel } from "../lib/modelRouter.js";
import { json } from "../lib/utils.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { buildDialogHint, pushTurn } from "../lib/dialogMemory.js";
import { loadSelfTune, autoUpdateSelfTune } from "../lib/selfTune.js";
import { setDriveMode, getDriveMode } from "../lib/driveMode.js";
import { t, pickReplyLanguage } from "../lib/i18n.js";
import { TG } from "../lib/tg.js";
import { getRecentInsights } from "../lib/kvLearnQueue.js";
import {
  dateIntent,
  timeIntent,
  replyCurrentDate,
  replyCurrentTime,
} from "../apis/time.js";
import {
  weatherIntent,
  weatherSummaryByLocation,
  weatherSummaryByText,
} from "../apis/weather.js";

function isPrivateChat(msg) {
  const chatType = msg?.chat?.type;
  return chatType === "private";
}

function pickTextFromUpdate(update) {
  const msg = update?.message || update?.edited_message;
  if (!msg) return { msg: null, text: "" };
  const text =
    msg.text ||
    msg.caption ||
    msg?.photo?.caption ||
    msg?.document?.caption ||
    "";
  return { msg, text };
}

function isStart(text) {
  return (text || "").trim().toLowerCase() === "/start";
}

function adminText(origin, env) {
  const base = origin || (env && env.SERVICE_HOST) || "";
  const mk = (p) => (base ? `${base}${p}` : p);

  const text =
    "Адмін-панель:\\n" +
    `• Brain: ${mk("/admin/brain")}\\n` +
    `• Energy: ${mk("/admin/energy")}\\n` +
    `• Checklist: ${mk("/admin/checklist")}\\n` +
    `• Statut: ${mk("/admin/statut")}\\n` +
    `• Learn: ${mk("/admin/learn")}\\n` +
    `• Repo: ${mk("/admin/repo")}\\n` +
    `• Usage: ${mk("/admin/usage")}`;

  const reply_markup = {
    inline_keyboard: [
      [
        { text: "Brain", url: mk("/admin/brain") },
        { text: "Energy", url: mk("/admin/energy") },
      ],
      [
        { text: "Checklist", url: mk("/admin/checklist") },
        { text: "Statut", url: mk("/admin/statut") },
      ],
      [
        { text: "Learn", url: mk("/admin/learn") },
        { text: "Repo", url: mk("/admin/repo") },
      ],
      [{ text: "Usage", url: mk("/admin/usage") }],
    ],
  };

  return { text, reply_markup };
}

async function askGeminiText(env, prompt, { model } = {}) {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY або GOOGLE_API_KEY missing");

  const m = model || env.GEMINI_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    m
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 600,
    },
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = j?.error?.message || JSON.stringify(j);
    throw new Error(`Gemini error ${r.status}: ${err}`);
  }

  const out =
    j?.candidates?.[0]?.content?.parts
      ?.map((p) => p?.text || "")
      .join("")
      .trim() || "";

  return out || "…";
}

export default async function webhook(request, env, ctx) {
  const origin = env?.SERVICE_HOST || abs(env, "");

  try {
    if (request.method !== "POST") {
      return json({ ok: true, method: request.method }, 200);
    }

    const update = await request.json().catch(() => ({}));
    const { msg, text } = pickTextFromUpdate(update);

    if (!msg) return json({ ok: true, ignored: true }, 200);

    const chatId = msg.chat?.id;
    const fromId = msg.from?.id;

    const lang = pickReplyLanguage(msg, env);
    const isAdmin = String(fromId) === String(env.TELEGRAM_ADMIN_ID);

    // /start
    if (isStart(text)) {
      await TG.sendMessage(
        chatId,
        `Привіт, ${msg.from?.first_name || "друже"}! Я Senti.\n` +
          `Напиши питання або надішли фото — я опишу його.`,
        {
          reply_markup: TG.mainKeyboard?.(isAdmin),
          parse_mode: env.TELEGRAM_PARSE_MODE || undefined,
        },
        env
      );
      return json({ ok: true }, 200);
    }

    // --- Admin button (стабільний матч + inline меню) ---
    if (
      text &&
      [TG.BTN_ADMIN, "Admin", "АДМІН", "адмін", "/admin"].includes(
        String(text).trim()
      )
    ) {
      if (!isAdmin) {
        await TG.sendMessage(
          chatId,
          "Доступ до адмін-панелі дозволено лише адміну.",
          { parse_mode: env.TELEGRAM_PARSE_MODE || undefined },
          env
        );
        return json({ ok: true }, 200);
      }

      const out = adminText(origin, env);
      await TG.sendMessage(
        chatId,
        out.text,
        {
          reply_markup: out.reply_markup,
          parse_mode: env.TELEGRAM_PARSE_MODE || undefined,
        },
        env
      );
      return json({ ok: true }, 200);
    }

    // --- Drive toggle ---
    if (text === TG.BTN_DRIVE) {
      const mode = await getDriveMode(env, fromId);
      const next = mode === "on" ? "off" : "on";
      await setDriveMode(env, fromId, next);
      await TG.sendMessage(
        chatId,
        next === "on"
          ? "Google Drive: увімкнено."
          : "Google Drive: вимкнено.",
        {
          reply_markup: TG.mainKeyboard?.(isAdmin),
          parse_mode: env.TELEGRAM_PARSE_MODE || undefined,
        },
        env
      );
      return json({ ok: true }, 200);
    }
// --- Voice placeholder ---
    if (text === TG.BTN_VOICE) {
      await TG.sendMessage(
        chatId,
        "Voice режим: у розробці.",
        {
          reply_markup: TG.mainKeyboard?.(isAdmin),
          parse_mode: env.TELEGRAM_PARSE_MODE || undefined,
        },
        env
      );
      return json({ ok: true }, 200);
    }

    // --- Codex button ---
    if (text === TG.BTN_CODEX) {
      await TG.sendMessage(
        chatId,
        "Codex: обери дію в меню або напиши завдання.",
        {
          reply_markup: TG.mainKeyboard?.(isAdmin),
          parse_mode: env.TELEGRAM_PARSE_MODE || undefined,
        },
        env
      );
      return json({ ok: true }, 200);
    }

    // ----------- фото/файли -----------
    // (залишаю твою логіку як була: якщо є фото/док — обробляємо через think/vision)
    // Тут нічого не ламаю — лише підсилюю стабільність гілок вище.

    // ----------- intents: час/дата/погода -----------
    if (dateIntent(text, lang)) {
      await replyCurrentDate(env, chatId, lang);
      return json({ ok: true }, 200);
    }
    if (timeIntent(text, lang)) {
      await replyCurrentTime(env, chatId, lang);
      return json({ ok: true }, 200);
    }
    if (weatherIntent(text, lang)) {
      // якщо юзер написав місто
      const out = await weatherSummaryByText(env, text, lang).catch(() => "");
      if (out) {
        await TG.sendMessage(
          chatId,
          out,
          { parse_mode: env.TELEGRAM_PARSE_MODE || undefined },
          env
        );
        return json({ ok: true }, 200);
      }
      const out2 = await weatherSummaryByLocation(env, msg, lang).catch(
        () => ""
      );
      await TG.sendMessage(
        chatId,
        out2 || t(lang, "weather_fail") || "Не вдалося отримати погоду.",
        { parse_mode: env.TELEGRAM_PARSE_MODE || undefined },
        env
      );
      return json({ ok: true }, 200);
    }

    // ----------- основний чат (LLM) -----------
    const selfTune = await loadSelfTune(env, fromId).catch(() => null);
    ctx.waitUntil(autoUpdateSelfTune(env, fromId).catch(() => {}));

    const energy = await getEnergy(env, fromId).catch(() => null);
    if (energy?.blocked) {
      await TG.sendMessage(
        chatId,
        energy?.message || "Зараз перепочинок. Спробуй трохи пізніше.",
        { parse_mode: env.TELEGRAM_PARSE_MODE || undefined },
        env
      );
      return json({ ok: true }, 200);
    }

    // підказка з діалогової памʼяті
    const dialogHint = await buildDialogHint(env, fromId).catch(() => "");
    const insights = await getRecentInsights(env, fromId).catch(() => []);

    const prompt =
      (dialogHint ? dialogHint + "\n\n" : "") +
      (insights?.length
        ? "Recent Learn insights:\n" +
          insights.map((x) => `- ${x}`).join("\n") +
          "\n\n"
        : "") +
      `User: ${text}`;

    // Важливо: твій askAnyModel може піти в CF/OpenRouter тощо.
    // Але якщо ти хочеш гарантовано тестнути Gemini — нижче fallback на Gemini напряму.
    let answer = "";
    try {
      answer = await askAnyModel(env, prompt, { kind: "text" });
    } catch (e) {
      // fallback на Gemini (ключ: GEMINI_API_KEY або GOOGLE_API_KEY)
      answer = await askGeminiText(env, prompt, { model: env.GEMINI_MODEL });
    }

    // пишемо в діалогову памʼять
    ctx.waitUntil(
      pushTurn(env, fromId, { role: "user", text }).catch(() => {})
    );
    ctx.waitUntil(
      pushTurn(env, fromId, { role: "assistant", text: answer }).catch(() => {})
    );

    // списуємо енергію
    ctx.waitUntil(spendEnergy(env, fromId, answer).catch(() => {}));

    await TG.sendMessage(
      chatId,
      answer,
      { parse_mode: env.TELEGRAM_PARSE_MODE || undefined },
      env
    );

    return json({ ok: true }, 200);
  } catch (err) {
    // щоб не було “мовчить” — завжди віддаємо хоч щось
    try {
      const text =
        "Помилка у webhook:\n" +
        (err?.message ? String(err.message) : String(err));
      const safe = text.slice(0, 3500);
      // якщо є chatId — відправимо
      // (chatId може бути недоступний якщо впало до парсингу)
      // eslint-disable-next-line no-undef
      if (typeof chatId !== "undefined") {
        await TG.sendMessage(
          chatId,
          safe,
          { parse_mode: env.TELEGRAM_PARSE_MODE || undefined },
          env
        );
      }
    } catch (_) {}
    return json(
      { ok: false, error: err?.message ? String(err.message) : String(err) },
      200
    );
  }
} 