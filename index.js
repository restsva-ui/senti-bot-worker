// Cloudflare Workers — ESM only
// env: { TELEGRAM_TOKEN, WEBHOOK_SECRET, AIMAGIC_SESS, AI }
const TG = {
  api(token, method, params) {
    const url = `https://api.telegram.org/bot${token}/${method}`;
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  },
};

async function replyTelegram(env, chatId, text, extra = {}) {
  return TG.api(env.TELEGRAM_TOKEN, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

function todayUA() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("uk-UA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    timeZone: "Europe/Kyiv",
  });
  return fmt.format(now);
}

async function usdToUah() {
  // простий та стабільний AUTO (exchangerate.host)
  const r = await fetch("https://api.exchangerate.host/latest?base=USD&symbols=UAH");
  const j = await r.json().catch(() => ({}));
  return j?.rates?.UAH ?? null;
}

function pickStartGreeting(name) {
  const n = name || "друже";
  const opts = [
    `${n}, привіт! 🌟 Я вже чекав нашої зустрічі!`,
    `Радий тебе бачити, ${n}! 🚀 Чим допомогти?`,
    `${n}, давай зробимо день трішки яскравішим ✨`,
    `Гей, ${n}! 😉 Пиши, що потрібно — усе зробимо.`,
    `${n}, вітаю! 🔥 Готовий підхопити будь-яку задачу.`,
  ];
  return opts[Math.floor(Math.random() * opts.length)];
}

async function handleTelegramUpdate(env, update) {
  const msg = update.message || update.edited_message;
  if (!msg || !msg.chat) return new Response("ok");

  const chatId = msg.chat.id;
  const name =
    msg.from?.first_name ||
    msg.chat?.first_name ||
    msg.from?.username ||
    "друже";

  const text = (msg.text || "").trim();

  // /start — одразу мовою користувача
  if (text.startsWith("/start")) {
    const greet = pickStartGreeting(name);
    await replyTelegram(env, chatId, `${greet}\n\nНапиши запит своїми словами або надішли фото 😉`);
    return new Response("ok");
  }

  // приклад: "Курс долара"
  if (/курс\s+долар/iu.test(text)) {
    const rate = await usdToUah();
    if (rate) {
      await replyTelegram(env, chatId, `Сьогодні: ${todayUA()}\n$1 ≈ ${rate.toFixed(2)} грн`);
    } else {
      await replyTelegram(env, chatId, `Сталась помилка з курсом. Спробуй ще раз пізніше.`);
    }
    return new Response("ok");
  }

  // дефолт
  await replyTelegram(env, chatId, `Окей, ${name}. Спробуй переформулювати або дай більше деталей 😉`);
  return new Response("ok");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // healthcheck
    if (request.method === "GET" && url.pathname === "/_status") {
      return new Response(
        JSON.stringify({ ok: true, service: "senti-bot-worker", version: "v4.1.4-esm" }),
        { headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    // Telegram вебхук: /<WEBHOOK_SECRET>
    if (url.pathname === `/${env.WEBHOOK_SECRET}` && request.method === "POST") {
      const update = await request.json().catch(() => ({}));
      return handleTelegramUpdate(env, update);
    }

    // інші запити
    return new Response("ok");
  },
};