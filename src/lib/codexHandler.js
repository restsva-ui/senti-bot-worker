// src/lib/codexHandler.js

// Основна ідея: є конфіг кодекса, є шаблони, є провайдери моделей.
// Ми робимо один вхід handleCodex(update, ctx) і повертаємо готовий текст/код,
// щоб webhook.js просто відправив у Telegram.

import * as codexConfig from "../config/codex.js";
import * as codexTemplates from "./codexTemplates.js";

// Діалогова пам'ять — у тебе в архіві є dialogMemory.js
import { loadDialog, saveDialog } from "./dialogMemory.js";

// Провайдери моделей (у тебе є 3 файли в src/lib/providers/)
import { runCfModel } from "./providers/cf.js";
import { runGeminiModel } from "./providers/gemini.js";
import { runOpenrouterModel } from "./providers/openrouter.js";

// Телеграм-утиліти (у тебе є і telegram.js, і tg.js — беремо легшу)
import { buildTelegramText } from "./telegram.js";

/**
 * Вибір провайдера згідно з конфігом кодекса
 */
async function runModelForCodex(prompt, ctx = {}) {
  const provider = codexConfig?.provider || "cf";
  const model = codexConfig?.model || null;

  if (provider === "gemini") {
    return await runGeminiModel({
      prompt,
      model,
      system: codexConfig?.systemPrompt || null,
    });
  }

  if (provider === "openrouter") {
    return await runOpenrouterModel({
      prompt,
      model,
      temperature: codexConfig?.temperature ?? 0.2,
    });
  }

  // default: Cloudflare Workers AI
  return await runCfModel({
    prompt,
    model,
    temperature: codexConfig?.temperature ?? 0.2,
  });
}

/**
 * Збираємо промпт для кодекса
 */
function buildCodexPrompt({ text, lang = "uk", history = [] }) {
  const base = codexTemplates?.baseCodexPrompt || "";
  const histStr =
    history && history.length
      ? history.map((h) => `user: ${h.user}\nassistant: ${h.assistant}`).join("\n")
      : "";

  // Можеш досилати ще system з config/codex.js
  return [
    base,
    codexConfig?.systemPrompt || "",
    histStr,
    "Користувач просить:",
    text,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Головний вхід: сюди передаємо вже “розпізнаний” запит до кодекса
 * update — сирий апдейт Telegram
 * ctx — твій контекст (env, kv, logger, tgSend)
 */
export async function handleCodex(update, ctx = {}) {
  // 1. Дістаємо текст користувача
  const msg =
    update?.message ||
    update?.edited_message ||
    update?.callback_query?.message ||
    null;

  const fromId =
    msg?.from?.id ||
    update?.callback_query?.from?.id ||
    update?.message?.from?.id;

  const chatId = msg?.chat?.id || update?.callback_query?.message?.chat?.id;

  const userText =
    msg?.text ||
    update?.callback_query?.data ||
    (msg?.caption || "").trim();

  if (!userText) {
    return {
      ok: false,
      reason: "NO_TEXT",
      reply: "Не бачу запиту для Codex.",
    };
  }

  // 2. вантажимо історію для цього юзера (довготривала пам'ять для codex)
  let history = [];
  try {
    history = (await loadDialog(fromId, "codex")) || [];
  } catch (e) {
    // не падаємо, просто без історії
    history = [];
  }

  // 3. готуємо промпт
  const prompt = buildCodexPrompt({
    text: userText,
    lang: "uk",
    history,
  });

  // 4. відправляємо в модель
  const modelResp = await runModelForCodex(prompt, ctx);

  const answerText =
    modelResp?.text ||
    modelResp?.result ||
    modelResp?.output ||
    "Не зміг згенерувати відповідь.";

  // 5. зберігаємо в історію
  try {
    const newItem = {
      user: userText,
      assistant: answerText,
      ts: Date.now(),
    };
    await saveDialog(fromId, "codex", [...history, newItem]);
  } catch (e) {
    // лог дописати при бажанні
  }

  // 6. готуємо відповідь для Telegram
  const tgMsg = buildTelegramText({
    chat_id: chatId,
    text: answerText,
    parse_mode: "Markdown",
  });

  return {
    ok: true,
    tg: tgMsg,
    text: answerText,
  };
}
