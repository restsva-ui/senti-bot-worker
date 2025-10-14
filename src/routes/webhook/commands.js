
// [4/7] src/routes/webhook/commands.js
import { mainKeyboard, inlineOpenDrive, BTN_DRIVE, BTN_SENTI, BTN_ADMIN, BTN_CHECK, ADMIN, energyLinks } from "./utils.js";
import { getAiHealthSummary } from "../../lib/modelRouter.js";

const DRIVE_MODE_KEY = (uid) => `drive_mode:${uid}`;
const ensureState = (env) => (env.STATE_KV || (() => { throw new Error("STATE_KV binding missing"); })());
async function setDriveMode(env, userId, on) {
  await ensureState(env).put(DRIVE_MODE_KEY(userId), on ? "1" : "0", { expirationTtl: 3600 });
}
export async function getDriveMode(env, userId) {
  return (await ensureState(env).get(DRIVE_MODE_KEY(userId))) === "1";
}

export async function handleStart(TG, env, chatId, userId) {
  await setDriveMode(env, userId, false);
  await TG.text(chatId, "Привіт! Я Senti 🤖", { reply_markup: mainKeyboard(ADMIN(env, userId)) });
}

export async function handleDiag(TG, env, chatId, modelOrder) {
  const hasGemini   = !!(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
  const hasCF       = !!(env.CF_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN);
  const hasOR       = !!env.OPENROUTER_API_KEY;
  const hasFreeBase = !!env.FREE_API_BASE_URL;
  const hasFreeKey  = !!env.FREE_API_KEY;

  const lines = [
    "🧪 Діагностика AI",
    `MODEL_ORDER: ${modelOrder || "(порожньо)"}`,
    `GEMINI key: ${hasGemini ? "✅" : "❌"}`,
    `Cloudflare (CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN): ${hasCF ? "✅" : "❌"}`,
    `OpenRouter key: ${hasOR ? "✅" : "❌"}`,
    `FreeLLM (BASE_URL + KEY): ${hasFreeBase && hasFreeKey ? "✅" : "❌"}`,
  ];

  if (modelOrder) {
    const entries = modelOrder.split(",").map(s => s.trim()).filter(Boolean);
    if (entries.length) {
      const health = await getAiHealthSummary(env, entries);
      lines.push("\n— Health:");
      for (const h of health) {
        const light = h.cool ? "🟥" : (h.slow ? "🟨" : "🟩");
        const ms = h.ewmaMs ? `${Math.round(h.ewmaMs)}ms` : "n/a";
        lines.push(`${light} ${h.provider}:${h.model} — ewma ${ms}, fails ${h.failStreak || 0}`);
      }
    }
  }
  await TG.text(chatId, lines.join("\n"));
}

export async function handleDriveOn(TG, env, chatId, userId) {
  await setDriveMode(env, userId, true);
  await TG.text(chatId, "📁 Режим диска: ON\nНадсилай фото/відео/документи — збережу на твій Google Drive.", {
    reply_markup: mainKeyboard(ADMIN(env, userId)),
  });
  await TG.text(chatId, "Переглянути вміст диска:", { reply_markup: inlineOpenDrive() });
}

export async function handleSentiMode(TG, env, chatId, userId) {
  await setDriveMode(env, userId, false);
  await TG.text(chatId, "Режим диска вимкнено. Це звичайний чат Senti.", {
    reply_markup: mainKeyboard(ADMIN(env, userId)),
  });
}

export async function handleChecklistLink(TG, env, chatId) {
  const link = `https://${env.SERVICE_HOST}/admin/checklist/html?s=${encodeURIComponent(env.WEBHOOK_SECRET || "")}`;
  await TG.text(chatId, `📋 Чеклист (HTML):\n${link}`);
}

export async function handleAdminMenu(TG, env, chatId) {
  const cl = `https://${env.SERVICE_HOST}/admin/checklist/html?s=${encodeURIComponent(env.WEBHOOK_SECRET || "")}`;
  const repo = `https://${env.SERVICE_HOST}/admin/repo/html?s=${encodeURIComponent(env.WEBHOOK_SECRET || "")}`;
  await TG.text(chatId, `🛠 Адмін-меню\n\n• Чеклист: ${cl}\n• Repo: ${repo}\n• Вебхук GET: https://${env.SERVICE_HOST}/webhook`);
}