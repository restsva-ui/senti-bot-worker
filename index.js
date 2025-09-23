// Senti Telegram bot on Cloudflare Workers + AI Gateway (Workers AI -> Llama 3.1 8B Instruct)

const TG_API = (token) => `https://api.telegram.org/bot${token}`;
// Модель Workers AI через AI Gateway
const WORKERS_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct"; // можна замінити на іншу модель із каталогу

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Простий ping/health
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      // Перевіряємо секрет (Telegram шле в заголовку X-Telegram-Bot-Api-Secret-Token)
      const tgSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (env.WEBHOOK_SECRET && tgSecret !== env.WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }

      const update = await request.json().catch(() => null);
      if (!update) return new Response("bad json", { status: 400 });

      try {
        // Обробка only messages
        if (update.message && update.message.chat && (update.message.text || update.message.caption)) {
          const chatId = update.message.chat.id;
          const userText = (update.message.text ?? update.message.caption ?? "").trim();

          // Системні команди
          if (userText === "/start") {
            await sendMessage(env, chatId, "Vitaliy, привіт! ✨ Я вже чекав нашої зустрічі! Напиши мені щось 😉");
            return new Response("ok", { status: 200 });
          }
          if (userText === "/help") {
            await sendMessage(env, chatId, "Напиши питання — я відповім. Підтримую українську та інші мови 🌍");
            return new Response("ok", { status: 200 });
          }
          if (userText === "/ping") {
            await sendMessage(env, chatId, "pong ✅");
            return new Response("ok", { status: 200 });
          }

          // Показуємо "typing…"
          ctx.waitUntil(sendChatAction(env, chatId, "typing"));

          // Готуємо промпт та питаємо модель
          const prompt = buildPrompt(userText, update);
          const aiText = await runWorkersAIThroughGateway(env, prompt);

          // Відповідаємо користувачу
          await sendMessage(env, chatId, aiText ?? "Вибач, сталася помилка під час відповіді 😿");

          return new Response("ok", { status: 200 });
        }

        // Інші типи апдейтів просто ігноруємо
        return new Response("ignored", { status: 200 });
      } catch (err) {
        console.error("Webhook error:", err);
        // Спробуємо м’яко повідомити користувача, якщо можемо
        try {
          if (update?.message?.chat?.id) {
            await sendMessage(env, update.message.chat.id, "Ой! Щось пішло не так на сервері. Спробуй ще раз 🙏");
          }
        } catch (_) {}
        return new Response("error", { status: 500 });
      }
    }

    return new Response("not found", { status: 404 });
  },
};

/** Формуємо дружній системний промпт */
function buildPrompt(userText, update) {
  const name = update?.message?.from?.first_name ?? "користувач";
  return [
    "Ти — помічник Senti. Відповідай коротко, дружньо, тією ж мовою, якою пише користувач.",
    "Якщо задають кроки/інструкції — структуруй відповідь списком.",
    "Уникай надто пафосних фраз. Будь корисним і конкретним.",
    "",
    `Користувач (${name}) написав: "${userText}"`,
  ].join("\n");
}

/** Виклик Workers AI через Cloudflare AI Gateway */
async function runWorkersAIThroughGateway(env, prompt) {
  const base = env.CF_AI_GATEWAY_BASE; // напр. https://gateway.ai.cloudflare.com/v1/<account>/<gateway>
  if (!base) throw new Error("CF_AI_GATEWAY_BASE is not set");
  if (!env.CF_API_TOKEN) throw new Error("CF_API_TOKEN is not set");

  const endpoint = `${base}/workers-ai/run/${WORKERS_AI_MODEL}`;

  const body = {
    // Workers AI очікує поле `prompt`
    prompt,
    // Можна налаштувати temperature / max_tokens, якщо модель підтримує
    // temperature: 0.3,
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await safeText(res);
    console.error("AI Gateway error:", res.status, text);
    return null;
  }

  // Формат відповіді Workers AI:
  // { result: { response: "..." }, ... }
  const data = await res.json().catch(() => null);
  const text = data?.result?.response ?? data?.response ?? null;
  return text;
}

/** Надіслати повідомлення у Telegram */
async function sendMessage(env, chatId, text) {
  // Щоб уникнути проблем з Markdown, використовуємо HTML або plain
  const res = await fetch(`${TG_API(env.TELEGRAM_TOKEN)}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      // parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const t = await safeText(res);
    console.error("sendMessage error:", res.status, t);
  }
}

/** Показати індикатор набору тексту (“typing…”) */
async function sendChatAction(env, chatId, action = "typing") {
  const res = await fetch(`${TG_API(env.TELEGRAM_TOKEN)}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action }),
  });
  if (!res.ok) {
    const t = await safeText(res);
    console.warn("sendChatAction warn:", res.status, t);
  }
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
