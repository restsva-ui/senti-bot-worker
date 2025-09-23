// index.js — Senti bot with brain: Gemini (free) + DeepSeek fallback + Vision (LLaVA)

// ---------- helpers ----------
const ok = (b = "ok") => new Response(b, { status: 200, headers: { "content-type": "text/plain" } });
const bad = (s = 400, m = "bad request") => new Response(m, { status: s, headers: { "content-type": "text/plain" } });

async function tg(env, method, payload) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const txt = await r.text().catch(() => "");
  let data = {};
  try { data = txt ? JSON.parse(txt) : {}; } catch {}
  if (!r.ok || data?.ok === false) throw new Error(`TG ${method} ${r.status}: ${txt}`);
  return data;
}
const tgTyping = (env, chat_id) => tg(env, "sendChatAction", { chat_id, action: "typing" }).catch(() => {});

// ---------- Gemini (free) ----------
async function geminiText(apiKey, prompt) {
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }]}],
      generationConfig: { temperature: 0.6, maxOutputTokens: 900 }
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${JSON.stringify(data)}`);
  const out =
    data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n").trim() ||
    data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!out) throw new Error("Gemini empty");
  return out.trim();
}

async function geminiVision(apiKey, imageArrayBuffer, prompt = "Опиши зображення.") {
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");
  const base64 = toB64(imageArrayBuffer);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: "image/jpeg", data: base64 } },
        { text: prompt }
      ]
    }],
    generationConfig: { temperature: 0.6, maxOutputTokens: 900 }
  };
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${JSON.stringify(data)}`);
  const out =
    data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n").trim() ||
    data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!out) throw new Error("Gemini Vision empty");
  return out.trim();
}

// ---------- DeepSeek (text fallback) ----------
async function deepseekText(apiKey, prompt) {
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY missing");
  // OpenAI-сумісний чат-ендпойнт DeepSeek
  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "deepseek-chat",           // дешевший/швидший, без «думок» R1
      temperature: 0.6,
      messages: [
        { role: "system", content: "Відповідай стисло, по суті, мовою користувача." },
        { role: "user", content: prompt }
      ]
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`DeepSeek ${r.status}: ${JSON.stringify(data)}`);
  const out = data?.choices?.[0]?.message?.content || "";
  if (!out) throw new Error("DeepSeek empty");
  return out.trim();
}

// ---------- Workers AI (image fallback: LLaVA) ----------
async function llavaVision(env, imageArrayBuffer, prompt = "Опиши зображення.") {
  const models = ["@cf/llava", "@cf/llava-hf/llava-1.5-7b", "@cf/llava-1.5-13b"];
  const image = new Uint8Array(imageArrayBuffer);
  let lastErr;
  for (const m of models) {
    try {
      const res = await env.AI.run(m, { prompt, image });
      const text = res?.text || res?.description || res?.result ||
        (Array.isArray(res?.results) ? res.results.map(x => x.text || x.description).join("\n") : "");
      if (text && String(text).trim()) return String(text).trim();
      lastErr = new Error("Empty LLaVA response");
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("LLaVA failed");
}

// ---------- utils ----------
function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ---------- main worker ----------
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      // health
      if (request.method === "GET" && url.pathname === "/") return ok("ok");

      // webhook
      if (request.method === "POST" && url.pathname === "/webhook") {
        // секрет вебхука (якщо встановлено)
        const expected = env.WEBHOOK_SECRET;
        if (expected) {
          const got = request.headers.get("x-telegram-bot-api-secret-token");
          if (!got || got !== expected) return ok("ok"); // тихо ідемо, щоб TG не ретраїв 500
        }
        if (!env.TELEGRAM_TOKEN) return ok("ok"); // без токена — тихо завершуємо

        // читаємо апдейт
        const update = await request.json().catch(() => ({}));
        const msg = update?.message;
        if (!msg) return ok("ok");

        const chatId = msg.chat?.id;
        const textIn = (msg.text || "").trim();
        const photos = msg.photo;

        // команди
        if (textIn === "/start") {
          await tg(env, "sendMessage", { chat_id: chatId, text: "Привіт! Надішли текст або фото — я допоможу. ✨" });
          return ok();
        }
        if (textIn === "/help") {
          await tg(env, "sendMessage", {
            chat_id: chatId,
            text: "Я розумію текст і зображення.\n• Текст — відповідаю через Gemini (безкоштовно), fallback DeepSeek.\n• Фото — аналіз через Gemini, fallback LLaVA.",
          });
          return ok();
        }

        // фото → vision
        if (Array.isArray(photos) && photos.length) {
          await tgTyping(env, chatId);
          try {
            const largest = photos[photos.length - 1];
            const fileId = largest.file_id;
            const fileInfo = await tg(env, "getFile", { file_id: fileId });
            const filePath = fileInfo?.result?.file_path;
            if (!filePath) throw new Error("No file_path from Telegram");
            const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_TOKEN}/${filePath}`;
            const imgRes = await fetch(fileUrl);
            if (!imgRes.ok) throw new Error("Failed to download file");
            const imageBuf = await imgRes.arrayBuffer();

            const prompt = msg.caption || "Опиши зображення, виділи важливі деталі.";
            let answer;
            try {
              answer = await geminiVision(env.GEMINI_API_KEY, imageBuf, prompt);
            } catch (e) {
              console.error("Gemini vision error:", e);
              answer = await llavaVision(env, imageBuf, prompt);
            }
            await tg(env, "sendMessage", { chat_id: chatId, text: answer || "Не вдалося описати зображення." });
          } catch (e) {
            console.error("Vision error:", e);
            await tg(env, "sendMessage", { chat_id: chatId, text: "Сталася помилка при аналізі зображення." });
          }
          return ok();
        }

        // текст → LLM
        if (textIn) {
          await tgTyping(env, chatId);
          let reply = "";
          try {
            reply = await geminiText(env.GEMINI_API_KEY, textIn);
          } catch (e1) {
            console.error("Gemini text error:", e1);
            try {
              if (env.DEEPSEEK_API_KEY) {
                reply = await deepseekText(env.DEEPSEEK_API_KEY, textIn);
              } else {
                reply = ""; // не заданий ключ — лишимо порожньо, піде fallback нижче
              }
            } catch (e2) {
              console.error("DeepSeek error:", e2);
            }
          }
          if (!reply) reply = "Зараз я перевантажений. Спробуй ще раз за хвилину 🙏";
          await tg(env, "sendMessage", { chat_id: chatId, text: reply, disable_web_page_preview: true });
          return ok();
        }

        return ok();
      }

      return bad(404, "not found");
    } catch (err) {
      console.error("Top-level error:", err);
      return ok("ok"); // НІКОЛИ не віддаємо 500 вебхуку
    }
  },
};