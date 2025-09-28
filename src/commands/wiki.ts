import { sendMessage } from "../utils/telegram";
import type { Env, TgUpdate } from "../types";

function extractQuery(text: string) {
  // /wiki, /wiki@botname, з параметром або без
  return text.replace(/^\/wiki(?:@\w+)?\s*/i, "").trim();
}

function truncate(s: string, max = 1200) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

export async function cmdWiki(env: Env, update: TgUpdate) {
  const chatId = update.message!.chat.id;
  const t = update.message?.text ?? "";
  const q = extractQuery(t);

  if (!q) {
    await sendMessage(env, chatId, "ℹ️ Використання: <b>/wiki &lt;запит&gt;</b>\nНапр.: <code>/wiki Київ</code>");
    return;
  }

  const url = `https://uk.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, { headers: { "accept": "application/json" } });
    if (!res.ok) {
      await sendMessage(env, chatId, "Не вдалося отримати дані з Вікіпедії. Спробуй інший запит.");
      return;
    }
    const data = await res.json() as any;

    // Може повертати disambiguation або помилку
    if (data?.type === "disambiguation") {
      await sendMessage(env, chatId, `📖 <b>${data.title}</b>\nЦе неоднозначний запит. Уточни, будь ласка.`);
      return;
    }
    if (!data?.extract) {
      await sendMessage(env, chatId, "Нічого не знайдено. Спробуй інший запит.");
      return;
    }

    const title = data.title || q;
    const extract = truncate(String(data.extract));
    await sendMessage(env, chatId, `📚 <b>${title}</b>\n\n${extract}`);
  } catch (e) {
    console.error("wiki error:", e);
    await sendMessage(env, chatId, "Сталася помилка при зверненні до Вікіпедії.");
  }
}