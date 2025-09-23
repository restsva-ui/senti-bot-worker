// index.js — Telegram bot + Vision (Gemini → fallback LLaVA on Cloudflare Workers AI)

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // Healthcheck
    if (req.method === "GET" && url.pathname === "/") {
      return new Response("ok", { status: 200 });
    }

    // Telegram webhook
    if (req.method === "POST" && url.pathname === "/webhook") {
      // Перевірка секрету вебхука (якщо в Telegram setWebhook було з secret_token)
      const got = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (env.WEBHOOK_SECRET && got !== env.WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }

      const update = await req.json().catch(() => ({}));
      if (!update?.message) return new Response("no message", { status: 200 });

      const chatId = update.message.chat?.id;
      const text = update.message.text;
      const photos = update.message.photo;

      // маленький helper для Telegram API
      const tg = async (method, body) => {
        const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return r.json();
      };

      // показуємо "typing…" під час довгих операцій
      const sendTyping = () => tg("sendChatAction", { chat_id: chatId, action: "typing" });

      // Мультимодальний сценарій — якщо прийшло фото
      if (Array.isArray(photos) && photos.length) {
        await sendTyping();

        try {
          // 1) беремо найбільше фото
          const largest = photos[photos.length - 1]; // останній зазвичай найбільший
          const fileId = largest.file_id;

          // 2) отримаємо file_path
          const fileInfo = await tg("getFile", { file_id: fileId });
          const filePath = fileInfo?.result?.file_path;
          if (!filePath) throw new Error("No file_path from Telegram");

          // 3) качаємо байти фото
          const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_TOKEN}/${filePath}`;
          const imgRes = await fetch(fileUrl);
          if (!imgRes.ok) throw new Error("Failed to download Telegram file");
          const imageBuf = await imgRes.arrayBuffer();

          // 4) промпт користувача (якщо разом із фото надіслали підпис)
          const userPrompt = update.message.caption || "Опиши зображення, розкажи важливі деталі.";

          // 5) Аналіз (спочатку Gemini → fallback LLaVA)
          let answer;
          try {
            answer = await analyzeWithGemini(imageBuf, userPrompt, env.GEMINI_API_KEY);
          } catch (e) {
            console.error("Gemini error:", e);
            answer = await analyzeWithLLAVA(imageBuf, userPrompt, env);
          }

          // 6) Відправляємо відповідь
          await tg("sendMessage", { chat_id: chatId, text: answer || "Не вдалося отримати опис ☹️" });
        } catch (e) {
          console.error("Photo handling error:", e);
          await tg("sendMessage", { chat_id: chatId, text: "Сталася помилка при аналізі зображення." });
        }

        return new Response("ok", { status: 200 });
      }

      // Текстові повідомлення (простий варіант; за бажанням можна теж вести через Gemini)
      if (typeof text === "string" && text.trim()) {
        await sendTyping();

        // базові команди
        if (text === "/start") {
          await tg("sendMessage", {
            chat_id: chatId,
            text: "Vitaliy, привіт! ✨ Я вже чекав нашої зустрічі! Надішли мені фото — опишу, що на ньому 😉",
          });
          return new Response("ok", { status: 200 });
        }

        // echo/заглушка
        await tg("sendMessage", {
          chat_id: chatId,
          text: "Надішли фото (можна з підписом), і я опишу все, що побачу 👀",
        });
        return new Response("ok", { status: 200 });
      }

      // якщо не фото і не текст — ігноруємо
      return new Response("ignored", { status: 200 });
    }

    return new Response("not found", { status: 404 });
  },
};

/* =========================
   GEMINI (основний аналіз)
   ========================= */
async function analyzeWithGemini(imageArrayBuffer, prompt, apiKey) {
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing");

  const base64 = arrayBufferToBase64(imageArrayBuffer);
  const body = {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: "image/jpeg", // Telegram JPG/WebP — якщо WebP, теж працює
              data: base64,
            },
          },
          { text: prompt || "Опиши зображення." },
        ],
      },
    ],
    generationConfig: { temperature: 0.6, maxOutputTokens: 900 },
  };

  // Модель: gemini-1.5-flash (швидка і дешева), можна замінити на pro
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" +
    encodeURIComponent(apiKey);

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error("Gemini HTTP " + r.status + ": " + txt);
  }
  const data = await r.json();
  // Витягуємо текст з candidates → content → parts
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n").trim() ||
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "";
  if (!text) throw new Error("Gemini returned empty text");
  return text;
}

/* =====================================
   LLaVA (fallback через Workers AI / AI)
   ===================================== */
async function analyzeWithLLAVA(imageArrayBuffer, prompt, env) {
  // Модель: найчастіше доступні "@cf/llava" або "@cf/llava-hf/llava-1.5-7b"
  const modelCandidates = ["@cf/llava", "@cf/llava-hf/llava-1.5-7b", "@cf/llava-1.5-13b"];

  const imageUint8 = new Uint8Array(imageArrayBuffer);
  let lastErr;

  for (const model of modelCandidates) {
    try {
      const out = await env.AI.run(model, {
        prompt: prompt || "Опиши зображення.",
        image: imageUint8, // Workers AI приймає Uint8Array
      });

      // Формати відповіді у LLaVA відрізняються — підстрахуємося
      const text =
        out?.text ||
        out?.description ||
        out?.result ||
        (Array.isArray(out?.results) ? out.results.map((x) => x.text || x.description).join("\n") : "");

      if (text && text.trim()) return text.trim();
      throw new Error("Empty LLaVA response");
    } catch (e) {
      lastErr = e;
      // пробуємо наступну модель
    }
  }

  throw lastErr || new Error("No LLaVA models worked");
}

/* ============
   helpers
   ============ */
function arrayBufferToBase64(buf) {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}