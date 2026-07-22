// src/routes/webhook.js
import { abs } from "../utils/url.js";
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

function pickMessage(update) {
  const msg = update?.message || update?.edited_message || null;
  const text = String(msg?.text || msg?.caption || "").trim();
  return { msg, text };
}

function isStart(text) {
  return String(text || "").trim().toLowerCase() === "/start";
}

function background(ctx, promise) {
  const guarded = Promise.resolve(promise).catch((error) => {
    console.error("[webhook.background]", error?.message || error);
  });

  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(guarded);
    return null;
  }

  return guarded;
}

function adminSecret(env) {
  return env.ADMIN_SECRET || env.WEBHOOK_SECRET || "";
}

function adminUrl(origin, path, env) {
  const url = new URL(path, origin || env.SERVICE_HOST || "https://localhost");
  const secret = adminSecret(env);
  if (secret) url.searchParams.set("s", secret);
  return url.toString();
}

function adminMenu(origin, env) {
  const links = {
    brain: adminUrl(origin, "/admin/brain", env),
    energy: adminUrl(origin, "/admin/energy", env),
    checklist: adminUrl(origin, "/admin/checklist", env),
    statut: adminUrl(origin, "/admin/statut", env),
    learn: adminUrl(origin, "/admin/learn", env),
    repo: adminUrl(origin, "/admin/repo/html", env),
    usage: adminUrl(origin, "/admin/usage", env),
  };

  return {
    text: [
      "Адмін-панель:",
      `• Brain: ${links.brain}`,
      `• Energy: ${links.energy}`,
      `• Checklist: ${links.checklist}`,
      `• Statut: ${links.statut}`,
      `• Learn: ${links.learn}`,
      `• Repo: ${links.repo}`,
      `• Usage: ${links.usage}`,
    ].join("\n"),
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Brain", url: links.brain },
          { text: "Energy", url: links.energy },
        ],
        [
          { text: "Checklist", url: links.checklist },
          { text: "Statut", url: links.statut },
        ],
        [
          { text: "Learn", url: links.learn },
          { text: "Repo", url: links.repo },
        ],
        [{ text: "Usage", url: links.usage }],
      ],
    },
  };
}

async function askGeminiText(env, prompt, { model } = {}) {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY missing");

  const selectedModel = model || env.GEMINI_MODEL || "gemini-2.5-flash";
  const endpoint = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent`
  );
  endpoint.searchParams.set("key", apiKey);

  const response = await fetch(endpoint.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 900 },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `Gemini HTTP ${response.status}`);
  }

  const answer = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part?.text || "")
    .join("")
    .trim();

  if (!answer) throw new Error("Gemini returned an empty answer");
  return answer;
}

function weatherMatched(intent) {
  if (typeof intent === "boolean") return intent;
  return Boolean(intent?.hit);
}

function weatherText(result) {
  if (typeof result === "string") return result;
  return String(result?.text || "").trim();
}

export default async function webhook(request, env, ctx) {
  let chatId = null;

  try {
    if (request.method !== "POST") {
      return json({ ok: true, method: request.method }, 200);
    }

    const update = await request.json().catch(() => ({}));
    const { msg, text } = pickMessage(update);
    if (!msg) return json({ ok: true, ignored: true }, 200);

    chatId = msg.chat?.id ?? null;
    const fromId = msg.from?.id ?? msg.chat?.id;
    const lang = pickReplyLanguage(msg, env);
    const isAdmin = TG.ADMIN(env, fromId, msg.from?.username);
    const origin = env.SERVICE_HOST || new URL(request.url).origin || abs(env, "");

    if (isStart(text)) {
      await TG.sendMessage(
        chatId,
        `Привіт, ${msg.from?.first_name || "друже"}! Я Senti.\nНапиши питання або надішли повідомлення.`,
        { reply_markup: TG.mainKeyboard(isAdmin) },
        env
      );
      return json({ ok: true }, 200);
    }

    if (
      text &&
      [TG.BTN_ADMIN, "Admin", "АДМІН", "адмін", "/admin"].includes(text)
    ) {
      if (!isAdmin) {
        await TG.sendMessage(chatId, "Доступ до адмін-панелі дозволено лише адміну.", {}, env);
        return json({ ok: true }, 200);
      }

      const menu = adminMenu(origin, env);
      await TG.sendMessage(chatId, menu.text, { reply_markup: menu.reply_markup }, env);
      return json({ ok: true }, 200);
    }

    if (text === TG.BTN_DRIVE) {
      const current = await getDriveMode(env, fromId);
      const next = current === "on" ? "off" : "on";
      await setDriveMode(env, fromId, next);
      await TG.sendMessage(
        chatId,
        next === "on" ? "Google Drive: увімкнено." : "Google Drive: вимкнено.",
        { reply_markup: TG.mainKeyboard(isAdmin) },
        env
      );
      return json({ ok: true }, 200);
    }

    if (text === TG.BTN_VOICE) {
      await TG.sendMessage(chatId, "Voice режим: у розробці.", { reply_markup: TG.mainKeyboard(isAdmin) }, env);
      return json({ ok: true }, 200);
    }

    if (text === TG.BTN_CODEX) {
      await TG.sendMessage(chatId, "Codex: напиши завдання для роботи з кодом.", { reply_markup: TG.mainKeyboard(isAdmin) }, env);
      return json({ ok: true }, 200);
    }

    if (dateIntent(text, lang)) {
      await replyCurrentDate(env, chatId, lang);
      return json({ ok: true }, 200);
    }

    if (timeIntent(text, lang)) {
      await replyCurrentTime(env, chatId, lang);
      return json({ ok: true }, 200);
    }

    const weather = weatherIntent(text, lang);
    if (weatherMatched(weather)) {
      let result = null;

      if (weather?.place) {
        result = await weatherSummaryByText(env, weather.place, lang).catch(() => null);
      }
      if (!weatherText(result) && text) {
        result = await weatherSummaryByText(env, text, lang).catch(() => null);
      }
      if (!weatherText(result) && msg.location) {
        result = await weatherSummaryByLocation(env, msg.location, lang).catch(() => null);
      }

      await TG.sendMessage(
        chatId,
        weatherText(result) || t(lang, "weather_fail") || "Не вдалося отримати погоду.",
        {},
        env
      );
      return json({ ok: true }, 200);
    }

    if (!text) {
      await TG.sendMessage(chatId, "Наразі я обробляю текстові повідомлення.", {}, env);
      return json({ ok: true, ignored: true }, 200);
    }

    await loadSelfTune(env, fromId).catch(() => null);
    const tuningTask = background(ctx, autoUpdateSelfTune(env, fromId));

    const energy = await getEnergy(env, fromId).catch(() => null);
    if (energy?.blocked) {
      if (tuningTask) await tuningTask;
      await TG.sendMessage(
        chatId,
        energy.message || "Зараз перепочинок. Спробуй трохи пізніше.",
        {},
        env
      );
      return json({ ok: true }, 200);
    }

    const [dialogHint, insights] = await Promise.all([
      buildDialogHint(env, fromId).catch(() => ""),
      getRecentInsights(env, fromId).catch(() => []),
    ]);

    const prompt = [
      dialogHint,
      Array.isArray(insights) && insights.length
        ? `Recent Learn insights:\n${insights.map((item) => `- ${item}`).join("\n")}`
        : "",
      `User: ${text}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    let answer;
    try {
      answer = await askAnyModel(env, prompt, { kind: "text" });
    } catch (routerError) {
      console.warn("[webhook.modelRouter]", routerError?.message || routerError);
      answer = await askGeminiText(env, prompt, { model: env.GEMINI_MODEL });
    }

    answer = String(answer || "").trim();
    if (!answer) throw new Error("Model returned an empty answer");

    const tasks = [
      pushTurn(env, fromId, { role: "user", text }),
      pushTurn(env, fromId, { role: "assistant", text: answer }),
      spendEnergy(env, fromId, answer),
    ];

    const pending = tasks.map((task) => background(ctx, task)).filter(Boolean);
    await TG.sendMessage(chatId, answer, {}, env);
    if (pending.length) await Promise.allSettled(pending);
    if (tuningTask) await tuningTask;

    return json({ ok: true }, 200);
  } catch (error) {
    console.error("[webhook]", error?.stack || error?.message || error);

    if (chatId !== null) {
      try {
        await TG.sendMessage(
          chatId,
          "Сталася внутрішня помилка. Спробуй повторити запит трохи пізніше.",
          {},
          env
        );
        return json({ ok: false, error: String(error?.message || error), notified: true }, 200);
      } catch (notifyError) {
        console.error("[webhook.notify]", notifyError?.message || notifyError);
      }
    }

    return json({ ok: false, error: String(error?.message || error) }, 500);
  }
}
