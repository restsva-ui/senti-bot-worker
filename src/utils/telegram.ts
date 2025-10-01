// src/utils/telegram.ts

export type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
};

const jsonHeaders = {
  "content-type": "application/json",
};

function tgBase(env: Env) {
  const base = (env.API_BASE_URL || "").trim() || "https://api.telegram.org";
  return `${base}/bot${env.BOT_TOKEN}`;
}

const TG_MAX_LEN = 4096;

/**
 * Розбиває текст на шматки ≤ TG_MAX_LEN.
 * Пріоритет розрізів: подвійний перенос → один перенос → пробіл → жорсткий зріз.
 * Старається не ламати код-блоки трійними бектиками.
 */
function splitForTelegram(text: string, max = TG_MAX_LEN): string[] {
  if (!text || text.length <= max) return [text];

  const chunks: string[] = [];
  let rest = text;

  // Стан відкритого код-блоку ```...```
  let codeOpen = false;

  while (rest.length > 0) {
    if (rest.length <= max) {
      // Якщо відкритий код-блок — закриваємо в кінці
      if (codeOpen && !rest.trimEnd().endsWith("```")) {
        chunks.push(rest + "\n```");
      } else {
        chunks.push(rest);
      }
      break;
    }

    // кандидат на зріз
    let cut = max;

    // Спроба — подвійний перенос
    let idx = rest.lastIndexOf("\n\n", max);
    if (idx < max * 0.6) idx = -1; // не різати занадто рано
    if (idx === -1) {
      // один перенос
      idx = rest.lastIndexOf("\n", max);
    }
    if (idx === -1) {
      // пробіл
      idx = rest.lastIndexOf(" ", max);
    }
    if (idx !== -1) cut = idx;

    let piece = rest.slice(0, cut).trimEnd();
    rest = rest.slice(cut).replace(/^\s+/, ""); // прибираємо ліві пробіли з нового шматка

    // Підрахунок трійних бектиків у шматку — щоб не розірвати код-блок
    const ticksInPiece = (piece.match(/```/g) || []).length;
    if (ticksInPiece % 2 === 1) {
      // парність змінилась — ми всередині/поза блоком
      codeOpen = !codeOpen;
    }

    if (codeOpen) {
      // Якщо код-блок відкрито — закриваємо його в кінці цього чанку
      piece += "\n```";
      // і відкриємо знову на початку наступного
      if (rest.length > 0) rest = "```\n" + rest;
    }

    chunks.push(piece);
  }

  return chunks;
}

/**
 * Надсилає повідомлення у Telegram. Довгі тексти розбиває на кілька sendMessage.
 * extra — будь-які стандартні поля Telegram (parse_mode, reply_markup, тощо).
 */
export async function tgSendMessage(
  env: Env,
  chat_id: number | string,
  text: string,
  extra: Record<string, unknown> = {}
) {
  if (!env.BOT_TOKEN) throw new Error("BOT_TOKEN is missing");

  // Дефолти можна перевизначити через extra
  const baseExtra = {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    ...extra,
  };

  const url = `${tgBase(env)}/sendMessage`;
  const parts = splitForTelegram(text, TG_MAX_LEN);

  let lastResp: any = null;

  for (const part of parts) {
    const body = JSON.stringify({ chat_id, text: part, ...baseExtra });
    const res = await fetch(url, { method: "POST", headers: jsonHeaders, body });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || (data && data.ok === false)) {
      throw new Error(
        `Telegram sendMessage failed: status=${res.status} body=${JSON.stringify(
          data || {}
        )}`
      );
    }
    lastResp = data;
    // Невелика пауза необов'язкова, але іноді корисна для дуже великих відповідей
    // await new Promise(r => setTimeout(r, 30));
  }

  return lastResp;
}

export async function tgAnswerCallbackQuery(
  env: Env,
  callback_query_id: string,
  text: string,
  show_alert = false
) {
  if (!env.BOT_TOKEN) throw new Error("BOT_TOKEN is missing");

  const url = `${tgBase(env)}/answerCallbackQuery`;
  const body = JSON.stringify({ callback_query_id, text, show_alert });

  const res = await fetch(url, { method: "POST", headers: jsonHeaders, body });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || (data && data.ok === false)) {
    throw new Error(
      `Telegram answerCallbackQuery failed: status=${res.status} body=${JSON.stringify(
        data || {}
      )}`
    );
  }
  return data;
}