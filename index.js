// === util responses ===
const json = (obj, init = {}) =>
  new Response(JSON.stringify(obj), { headers: { "content-type": "application/json;charset=utf-8" }, ...init });
const text = (body, init = {}) =>
  new Response(body, { headers: { "content-type": "text/plain" }, ...init });
const ok = (body = "ok") => text(body, { status: 200 });
const bad = (status = 400, msg = "bad request") => text(msg, { status });

// === telegram helpers ===
async function tg(apiBase, method, payload) {
  const r = await fetch(`${apiBase}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`TG ${method} ${r.status}: ${body}`);
  return JSON.parse(body || "{}");
}
function greet(name) { const who = name ? `, ${name}` : ""; return `Привіт${who}! ✨ Я вже чекав нашої зустрічі!`; }

// === LLM providers ===
// 1) Gemini (AI Studio) – безкоштовний tier
async function llmGemini(apiKey, userText, sys = "Be helpful. Reply in user's language.") {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + apiKey;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { role: "system", parts: [{ text: sys }] },
      contents: [{ role: "user", parts: [{ text: userText }]}],
      generationConfig: { temperature: 0.5 },
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${JSON.stringify(data)}`);
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}

// 2) Groq – швидко і щедрий безкоштовний доступ
async function llmGroq(apiKey, userText, model = "llama-3.1-8b-instant", sys = "Be helpful. Reply in user's language.") {
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.5,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userText }
      ]
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Groq ${resp.status}: ${JSON.stringify(data)}`);
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

// 3) Cloudflare Workers AI – fallback (binding AI)
async function llmCF(env, userText, model = "@cf/meta/llama-3.1-8b-instruct", sys = "Be helpful. Reply in user's language.") {
  // Workers AI: env.AI.run(model, { messages: [...] })
  const res = await env.AI.run(model, {
    messages: [
      { role: "system", content: sys },
      { role: "user", content: userText }
    ],
    temperature: 0.5
  });
  const out = res?.response || res?.result || "";
  if (!out) throw new Error("CF AI empty response");
  return String(out).trim();
}

// === router: вибір провайдера + фейловер ===
function isHardTask(text) {
  // дуже просте правило: довгі/складні запити — «hard»
  const len = (text || "").split(/\s+/).length;
  return len > 120 || /код|code|regex|оптимізуй|оптимизируй|архітектур|architecture|рефактор/i.test(text);
}

async function aiReply(env, userText) {
  const sys = "Відповідай стисло, по суті, мовою користувача. Якщо це код — додай короткі коментарі.";
  const wantHard = isHardTask(userText);

  // Порядок провайдерів можна керувати через env.AI_PROVIDERS="gemini,groq,cfai"
  const order = (env.AI_PROVIDERS || "gemini,groq,cfai")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  const tries = [];
  for (const p of order) {
    try {
      if (p === "gemini" && env.GEMINI_API_KEY) {
        return await llmGemini(env.GEMINI_API_KEY, userText, sys);
      }
      if (p === "groq" && env.GROQ_API_KEY) {
        // для «важких» — візьмемо більшу/точнішу модель
        const model = wantHard ? "gemma2-9b-it" : "llama-3.1-8b-instant";
        return await llmGroq(env.GROQ_API_KEY, userText, model, sys);
      }
      if (p === "cfai" && env.AI) {
        const model = wantHard ? "@cf/meta/llama-3.1-70b-instruct" : "@cf/meta/llama-3.1-8b-instruct";
        return await llmCF(env, userText, model, sys);
      }
      // якщо ключа/байндинга нема — пропускаємо
      tries.push(`${p}: skipped`);
    } catch (e) {
      tries.push(`${p}: ${e.message || e}`);
      continue; // фейловер до наступного
    }
  }
  // якщо нічого не вдалось — повертаємо діагностику користувачу
  return `На жаль, зараз моделі недоступні.\n\nСпробував: ${tries.join(" | ")}`;
}

// === main worker ===
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // health
    if (request.method === "GET" && url.pathname === "/") return ok("ok");

    const BOT_TOKEN = env.TELEGRAM_TOKEN;
    const WEBHOOK_SECRET = env.WEBHOOK_SECRET;
    if (!BOT_TOKEN) return bad(500, "TELEGRAM_TOKEN is missing");
    if (!WEBHOOK_SECRET) return bad(500, "WEBHOOK_SECRET is missing");
    const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

    // manual webhook setter
    if (request.method === "GET" && url.pathname === "/setwebhook") {
      if (url.searchParams.get("secret") !== WEBHOOK_SECRET) return bad(403, "forbidden");
      const hookUrl = `${url.origin}/webhook`;
      const res = await tg(API, "setWebhook", {
        url: hookUrl, secret_token: WEBHOOK_SECRET,
        allowed_updates: ["message"], max_connections: 40,
      });
      return json({ status: "ok", set_to: hookUrl, tg: res });
    }

    // telegram webhook
    if (request.method === "POST" && url.pathname === "/webhook") {
      // header secret check
      const got = request.headers.get("x-telegram-bot-api-secret-token");
      if (got !== WEBHOOK_SECRET) return bad(403, "forbidden");

      const update = await request.json().catch(() => null);
      if (!update) return bad(400, "no update");

      const msg = update.message;
      if (!msg) return ok();

      const chatId = msg.chat?.id;
      const textIn = (msg.text || "").trim();

      if (textIn === "/start") {
        const name = msg.from?.first_name || "";
        await tg(API, "sendMessage", { chat_id: chatId, text: greet(name) });
        return ok();
      }
      if (textIn === "/help") {
        await tg(API, "sendMessage", {
          chat_id: chatId,
          text: "Команди:\n/start — вітання\n/help — допомога\nБудь-який текст — відповідь від Сенті (LLM)."
        });
        return ok();
      }

      if (textIn) {
        const reply = await aiReply(env, textIn);
        await tg(API, "sendMessage", { chat_id: chatId, text: reply });
        return ok();
      }

      return ok();
    }

    return bad(404, "not found");
  },
};
