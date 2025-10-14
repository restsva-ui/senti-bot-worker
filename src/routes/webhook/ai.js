// [5/7] src/routes/webhook/ai.js
import { askAnyModel } from "../../lib/modelRouter.js";
import { think } from "../../lib/brain.js";
import { buildSystemHint } from "./context.js";
import { spendEnergy } from "../../lib/energy.js";
import { pushContext, rememberUserMessage, rememberBotMessage } from "../../lib/memory.js";
import { energyLinks, defaultAiReply, isBlank } from "./utils.js";

export async function handleAiSlash(TG, env, chatId, userId, query) {
  if (!query) {
    await TG.text(chatId, "✍️ Надішли запит після команди /ai. Приклад:\n/ai Скільки буде 2+2?");
    return;
  }

  // списання енергії за текст
  const costText = Number(env.ENERGY_COST_TEXT ?? 1);
  const low      = Number(env.ENERGY_LOW_THRESHOLD ?? 10);
  const spent    = await spendEnergy(env, userId, costText, "text");
  if (spent.energy < 0 || spent.energy <= low) {
    const links = energyLinks(env, userId);
    await TG.text(chatId, `🔋 Не вистачає енергії (потрібно ${costText}).\nВона відновлюється автоматично.\nКерування:\n• Energy: ${links.energy}\n• Checklist: ${links.checklist}`);
    return;
  }

  const systemHint = await buildSystemHint(env, chatId);
  const modelOrder = String(env.MODEL_ORDER || "").trim();

  let reply = "";
  try {
    if (modelOrder) {
      const merged = `${systemHint}\n\nКористувач: ${query}`;
      reply = await askAnyModel(env, merged, { temperature: 0.6, max_tokens: 800 });
    } else {
      reply = await think(env, query, systemHint);
    }
  } catch (e) {
    reply = `🧠 Помилка AI: ${String(e?.message || e)}`;
  }

  if (isBlank(reply)) reply = defaultAiReply();

  await rememberUserMessage(env, chatId, query);
  await rememberBotMessage(env, chatId, reply);

  if (spent.energy <= low) {
    const links = energyLinks(env, userId);
    reply += `\n\n⚠️ Низький рівень енергії (${spent.energy}). Керування: ${links.energy}`;
  }
  await TG.text(chatId, reply);
}

export async function handlePlainText(TG, env, chatId, userId, text) {
  const costText = Number(env.ENERGY_COST_TEXT ?? 1);
  const low      = Number(env.ENERGY_LOW_THRESHOLD ?? 10);
  const spent    = await spendEnergy(env, userId, costText, "text");
  if (spent.energy < 0 || spent.energy <= low) {
    const links = energyLinks(env, userId);
    await TG.text(chatId, `🔋 Не вистачає енергії (потрібно ${costText}). Відновлення авто.\nEnergy: ${links.energy}`);
    return;
  }

  const systemHint = await buildSystemHint(env, chatId);
  const modelOrder = String(env.MODEL_ORDER || "").trim();
  let out = "";

  try {
    if (modelOrder) {
      const merged = `${systemHint}\n\nКористувач: ${text}`;
      out = await askAnyModel(env, merged, { temperature: 0.6, max_tokens: 800 });
    } else {
      out = await think(env, text, systemHint);
    }
  } catch (e) {
    out = defaultAiReply();
  }

  await rememberUserMessage(env, chatId, text);
  await rememberBotMessage(env, chatId, out);

  if (spent.energy <= low) {
    const links = energyLinks(env, userId);
    out += `\n\n⚠️ Низький рівень енергії (${spent.energy}). Керування: ${links.energy}`;
  }
  await TG.text(chatId, out);
}
