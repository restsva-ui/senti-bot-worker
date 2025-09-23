// index.js — ES Module

const TG_API = (token, method, body) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const ok = (data = { ok: true }) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const bad = (msg, code = 400) =>
  new Response(JSON.stringify({ ok: false, error: msg }), {
    status: code,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

async function fxAuto(base = "UAH", symbols = "USD") {
  const url = `https://api.exchangerate.host/latest?base=${encodeURIComponent(
    base
  )}&symbols=${encodeURIComponent(symbols)}`;
  const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 600 } });
  if (!r.ok) throw new Error("FX HTTP " + r.status);
  const j = await r.json();
  return j.rates?.[symbols];
}

function pickLang(text) {
  const t = (text || "").toLowerCase();
  if (/[а-щьюяєіїґ]/.test(t)) return "uk";
  if (/[а-яё]/.test(t)) return "ru";
  return "en";
}

function greet(name = "друже", lang = "uk") {
  const map = {
    uk: [
      `Привіт, ${name}! Давай зробимо день трішки яскравішим ✨`,
      `Гей, ${name}! Я вже чекав на нашу зустріч 🌟`,
      `${name}, вітаю! Чим допомогти сьогодні? 🙂`,
      `Йо, ${name}! Поїхали творити магію 💫`,
      `Вітаю, ${name}! Готовий підстрахувати у всьому 🤝`,
      `${name}, радий бачити! Запитуй що завгодно 🙌`,
    ],
    en: [
      `Hey ${name}! Let’s make the day brighter ✨`,
      `Hi ${name}! I’ve been waiting for this moment 🌟`,
      `Welcome, ${name}! What do you need today? 🙂`,
      `Yo ${name}! Let’s make some magic 💫`,
      `Hi ${name}! I’ve got your back 🤝`,
      `${name}, great to see you! Ask me anything 🙌`,
    ],
    ru: [
      `Привет, ${name}! Давай сделаем день ярче ✨`,
      `Хей, ${name}! Я уже ждал нашей встречи 🌟`,
      `${name}, привет! Чем помочь сегодня? 🙂`,
      `Йо, ${name}! Погнали творить магию 💫`,
      `Здорова, ${name}! Подстрахую во всём 🤝`,
      `${name}, рад видеть! Спрашивай что угодно 🙌`,
    ],
  };
  const arr = map[lang] || map.en;
  return arr[Math.floor(Math.random() * arr.length)];
}

async function handleTelegram(update, env) {
  const token = env.TELEGRAM_TOKEN;
  if (!token) return;

  const msg = update.message || update.edited_message;
  if (!msg) return ok();

  const chatId = msg.chat.id;
  const userName = msg.from?.first_name || msg.chat?.first_name || "друже";
  const lang = msg.from?.language_code || pickLang(msg.text);
  const text = (msg.text || "").trim();

  if (text === "/start") {
    const hi = greet(userName, lang);
    await TG_API(token, "sendMessage", { chat_id: chatId, text: hi });
    return ok();
  }

  if (/курс|долар|доллара|usd|eur|євро/i.test(text)) {
    const isUSD = /usd|долар/i.test(text);
    const sym = isUSD ? "USD" : "EUR";
    try {
      const rate = await fxAuto("UAH", sym);
      const ans = rate
        ? `1 ${sym} ≈ ${(rate).toFixed(2)} грн`
        : `Сталась помилка з курсом.`;
      await TG_API(token, "sendMessage", { chat_id: chatId, text: ans });
    } catch {
      await TG_API(token, "sendMessage", {
        chat_id: chatId,
        text: "Сталась помилка з курсом.",
      });
    }
    return ok();
  }

  if (/^echo\s+/i.test(text)) {
    const echo = text.replace(/^echo\s+/i, "");
    await TG_API(token, "sendMessage", { chat_id: chatId, text: echo });
    return ok();
  }

  await TG_API(token, "sendMessage", {
    chat_id: chatId,
    text:
      lang === "uk"
        ? `Окей, ${userName}. Спробуй переформулювати або дай більше деталей 😉`
        : lang === "ru"
        ? `Окей, ${userName}. Попробуй переформулировать или дай больше деталей 😉`
        : `Okay, ${userName}. Try to rephrase or add more details 😉`,
  });

  return ok();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === "/_status") {
      return ok({
        ok: true,
        worker: "senti-bot-worker",
        kv: !!env.AIMAGIC_SESS,
        time: new Date().toISOString(),
      });
    }

    if (pathname === "/setwebhook" && request.method === "POST") {
      const token = env.TELEGRAM_TOKEN;
      const hook = env.WEBHOOK_SECRET;
      if (!token || !hook) return bad("no tg secrets", 500);
      const r = await fetch(
        `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(
          `${url.origin}/${hook}`
        )}`
      );
      const j = await r.json();
      return ok(j);
    }

    if (pathname === `/${env.WEBHOOK_SECRET}` && request.method === "POST") {
      const update = await request.json();
      return handleTelegram(update, env);
    }

    return new Response("ok", { status: 200 });
  },
};