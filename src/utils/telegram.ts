// src/utils/telegram.ts

export type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
};

const jsonHeaders = { "content-type": "application/json" };

function tgBase(env: Env) {
  const base = (env.API_BASE_URL || "").trim() || "https://api.telegram.org";
  return `${base}/bot${env.BOT_TOKEN}`;
}

const TG_MAX_LEN = 4096;

/* ------------------------ helpers ------------------------ */

/** Видаляє або знешкоджує проблемні Markdown-символи. */
function sanitizeMarkdown(raw: string): string {
  // Приберемо найчастіші причини "can't parse entities"
  // _ * [ ] ( ) ~ ` > # + - = | { } . !
  return raw
    .replace(/[`]/g, "'")     // бектики замінимо на апостроф
    .replace(/[_*[\]()~>#+=|{}.!]/g, (m) => {
      if (m === "." || m === "!") return m; // залишимо їх
      return " ";                           // інші — пробіл
    })
    .replace(/\s{2,}/g, " ");
}

/** Розбиває довгі тексти на шматки ≤ 4096, не рве ```код-блоки```. */
function splitForTelegram(text: string, max = TG_MAX_LEN): string[] {
  if (!text || text.length <= max) return [text];

  const chunks: string[] = [];
  let rest = text;
  let codeOpen = false;

  while (rest.length > 0) {
    if (rest.length <= max) {
      if (codeOpen && !rest.trimEnd().endsWith("```")) {
        chunks.push(rest + "\n```");
      } else {
        chunks.push(rest);
      }
      break;
    }

    let cut = max;
    let idx = rest.lastIndexOf("\n\n", max);
    if (idx < Math.floor(max * 0.6)) idx = -1;
    if (idx === -1) idx = rest.lastIndexOf("\n", max);
    if (idx === -1) idx = rest.lastIndexOf(" ", max);
    if (idx !== -1) cut = idx;

    let piece = rest.slice(0, cut).trimEnd();
    rest = rest.slice(cut).replace(/^\s+/, "");

    const ticks = (piece.match(/```/g) || []).length;
    if (ticks % 2 === 1) codeOpen = !codeOpen;

    if (codeOpen) {
      piece += "\n```";
      if (rest.length > 0) rest = "```\n" + rest;
    }

    chunks.push(piece);
  }

  return chunks;
}

type TryResult = {
  ok: boolean;
  status: number;
  data: any;
  description?: string;
};

async function trySendMessage(
  env: Env,
  chat_id: number | string,
  text: string,
  extra: Record<string, unknown>
): Promise<TryResult> {
  const url = `${tgBase(env)}/sendMessage`;
  const body = JSON.stringify({ chat_id, text, ...extra });
  const res = await fetch(url, { method: "POST", headers: jsonHeaders, body });
  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // інколи Telegram може повернути не-JSON при помилці
    data = {};
  }
  const ok = !!data?.ok && res.ok;
  return {
    ok,
    status: res.status,
    data,
    description: data?.description || (ok ? undefined : "unknown error"),
  };
}

/* ------------------------ public API ------------------------ */

/**
 * Надсилає текст у Telegram. Довгі повідомлення діляться автоматично.
 * Ретраї:
 *  1) як є (extra),
 *  2) без parse_mode,
 *  3) з sanitizeMarkdown.
 * Якщо всі спроби провалені — шле коротке службове повідомлення, а не кидає помилку.
 */
export async function tgSendMessage(
  env: Env,
  chat_id: number | string,
  text: string,
  extra: Record<string, unknown> = {}
) {
  if (!env.BOT_TOKEN) {
    throw new Error("BOT_TOKEN is missing");
  }

  // дефолти можна перевизначити ззовні
  const baseExtra: Record<string, unknown> = {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    ...extra,
  };

  const parts = splitForTelegram(String(text), TG_MAX_LEN);
  let lastOk: any = null;

  for (const part of parts) {
    // 1) як є
    let r = await trySendMessage(env, chat_id, part, baseExtra);
    if (!r.ok && r.status === 400) {
      // 2) без parse_mode
      const noParse = { ...baseExtra };
      delete (noParse as any).parse_mode;
      r = await trySendMessage(env, chat_id, part, noParse);
      if (!r.ok) {
        // 3) sanitize
        const cleaned = sanitizeMarkdown(part);
        r = await trySendMessage(env, chat_id, cleaned, noParse);
      }
    }

    if (!r.ok) {
      // фінальний м’який фолбек — коротке службове повідомлення
      const note =
        "Вибач, не вдалося надіслати одне з повідомлень (Telegram відхилив форматування). " +
        "Я спробую надалі надсилати простіший текст.";
      await trySendMessage(
        env,
        chat_id,
        note,
        { disable_web_page_preview: true } // без parse_mode
      );
      // і не валимо всю відповідь
    } else {
      lastOk = r.data;
    }
  }

  return lastOk;
}

export async function tgAnswerCallbackQuery(
  env: Env,
  callback_query_id: string,
  text: string,
  show_alert = false
) {
  if (!env.BOT_TOKEN) {
    throw new Error("BOT_TOKEN is missing");
  }
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