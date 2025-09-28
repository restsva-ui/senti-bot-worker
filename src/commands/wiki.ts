// src/commands/wiki.ts
import { sendMessage } from "../utils/telegram";
import type { Env } from "../index";

export async function cmdWiki(env: Env, update: any) {
  const chatId = update.message.chat.id;
  const text = update.message.text || "";

  // Виділяємо запит після команди
  const query = text.replace(/^\/wiki(@\w+)?\s*/i, "").trim();

  if (!query) {
    await sendMessage(
      env,
      chatId,
      "Використання: /wiki <запит>\nНапр.: /wiki Київ"
    );
    return;
  }

  try {
    const url = `https://uk.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      query
    )}`;
    const res = await fetch(url, { headers: { "User-Agent": "SentiBot/1.0" } });

    if (!res.ok) {
      throw new Error("Wiki fetch error");
    }

    const data = await res.json<any>();

    if (data.extract) {
      const summary =
        data.extract.length > 800
          ? data.extract.slice(0, 800) + "…"
          : data.extract;
      await sendMessage(env, chatId, `📖 ${data.title}\n\n${summary}`);
    } else {
      await sendMessage(env, chatId, `Не знайшов статтю для: ${query}`);
    }
  } catch (err) {
    console.error("wiki error", err);
    await sendMessage(env, chatId, "Сталася помилка при зверненні до Вікі.");
  }
}