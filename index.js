// index.js — Senti bot with dynamic AI_PROVIDERS
// Основний: Gemini (free), fallback: DeepSeek (text) / LLaVA (vision)

const ok = (b = "ok") => new Response(b, { status: 200 });
const bad = (s = 400, m = "bad request") => new Response(m, { status: s });

// ---------- Telegram ----------
async function tg(env, method, payload) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const txt = await r.text().catch(() => "");
  try {
    const data = JSON.parse(txt);
    if (!r.ok || data?.ok === false) throw new Error(txt);
    return data;
  } catch {
    throw new Error(`TG ${method} ${r.status}: ${txt}`);
  }
}
const tgTyping = (env, chat_id) =>
  tg(env, "sendChatAction", { chat_id, action: "typing" }).catch(() => {});

// ---------- Gemini ----------
async function geminiText(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }]}],
      generationConfig: { temperature: 0.6, maxOutputTokens: 800 }
    }),
  });
  const d = await r.json();
  return d?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n").trim() || "";
}
async function geminiVision(apiKey, buf, prompt) {
  const base64 = toB64(buf);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [
      { inline_data: { mime_type: "image/jpeg", data: base64 }},
      { text: prompt || "Опиши зображення." }
    ]}]
  };
  const r = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const d = await r.json();
  return d?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n").trim() || "";
}

// ---------- DeepSeek ----------
async function deepseekText(apiKey, prompt) {
  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: "Відповідай коротко, мовою користувача." },
        { role: "user", content: prompt }
      ]
    })
  });
  const d = await r.json();
  return d?.choices?.[0]?.message?.content?.trim() || "";
}

// ---------- LLaVA ----------
async function llavaVision(env, buf, prompt) {
  const image = new Uint8Array(buf);
  const res = await env.AI.run("@cf/llava", { prompt, image });
  return res?.text || res?.description || "";
}

// ---------- Providers router ----------
async function runProvider(env, type, input, buf) {
  // env.AI_PROVIDERS = "text:gemini,deepseek;vision:gemini,llava"
  const config = (env.AI_PROVIDERS || "").split(";");
  const map = {};
  for (const seg of config) {
    const [k,v] = seg.split(":");
    if (k && v) map[k.trim()] = v.split(",").map(x=>x.trim());
  }
  const order = map[type] || [];

  for (const provider of order) {
    try {
      if (type === "text" && provider === "gemini")
        return await geminiText(env.GEMINI_API_KEY, input);
      if (type === "text" && provider === "deepseek")
        return await deepseekText(env.DEEPSEEK_API_KEY, input);
      if (type === "vision" && provider === "gemini")
        return await geminiVision(env.GEMINI_API_KEY, buf, input);
      if (type === "vision" && provider === "llava")
        return await llavaVision(env, buf, input);
    } catch (e) {
      console.error(`${provider} failed:`, e);
    }
  }
  return "";
}

// ---------- utils ----------
function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin=""; for (let b of bytes) bin+=String.fromCharCode(b);
  return btoa(bin);
}

// ---------- main ----------
export default {
  async fetch(req, env) {
    try {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/") return ok("ok");

      if (req.method === "POST" && url.pathname === "/webhook") {
        if (env.WEBHOOK_SECRET) {
          const got = req.headers.get("x-telegram-bot-api-secret-token");
          if (got !== env.WEBHOOK_SECRET) return ok("ok");
        }
        const upd = await req.json().catch(()=>({}));
        const msg = upd?.message; if (!msg) return ok("ok");

        const chatId = msg.chat?.id;
        const text = msg.text?.trim();
        const photos = msg.photo;

        if (text === "/start") {
          await tg(env,"sendMessage",{chat_id:chatId,text:"Привіт! Надішли текст чи фото — я відповім 🤖"});
          return ok();
        }

        if (Array.isArray(photos) && photos.length) {
          await tgTyping(env, chatId);
          const fileId = photos.at(-1).file_id;
          const fileInfo = await tg(env,"getFile",{file_id:fileId});
          const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_TOKEN}/${fileInfo.result.file_path}`;
          const img = await fetch(fileUrl).then(r=>r.arrayBuffer());
          const prompt = msg.caption || "Опиши це зображення.";
          let ans = await runProvider(env,"vision",prompt,img);
          if (!ans) ans="Не вдалося описати зображення.";
          await tg(env,"sendMessage",{chat_id:chatId,text:ans});
          return ok();
        }

        if (text) {
          await tgTyping(env, chatId);
          let ans = await runProvider(env,"text",text);
          if (!ans) ans="Я зараз перевантажений 🙏 спробуй ще раз.";
          await tg(env,"sendMessage",{chat_id:chatId,text:ans});
          return ok();
        }

        return ok();
      }

      return bad(404,"not found");
    } catch(e) {
      console.error("Worker error:",e);
      return ok("ok");
    }
  }
};