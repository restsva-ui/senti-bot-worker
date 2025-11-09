// src/lib/codexTemplates.js
// Готові шаблони для /codex_template

export const CODEX_TEMPLATES = {
  "tg-bot": `// index.js
// Простий Telegram-бот на Node.js (fetch)
// Заміни <BOT_TOKEN> на свій токен

const TOKEN = process.env.BOT_TOKEN || "<BOT_TOKEN>";
const TG_API = "https://api.telegram.org";

async function sendMessage(chatId, text) {
  await fetch(\`\${TG_API}/bot\${TOKEN}/sendMessage\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

export default {
  async fetch(req) {
    if (req.method === "POST") {
      const update = await req.json();
      const msg = update.message;
      if (msg?.text === "/start") {
        await sendMessage(msg.chat.id, "Привіт! Це каркас Telegram-бота.");
      } else if (msg?.text) {
        await sendMessage(msg.chat.id, "Ти написав: " + msg.text);
      }
      return new Response("OK");
    }
    return new Response("TG bot is running");
  },
};
`,

  "cf-worker": `// worker.js
// Базовий Cloudflare Worker

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (url.pathname === "/") {
      return new Response("Senti Worker alive");
    }

    if (url.pathname === "/webhook" && req.method === "POST") {
      const upd = await req.json();
      // TODO: розбір Telegram
      return new Response("OK");
    }

    return new Response("Not found", { status: 404 });
  },
};
`,

  "landing": `<!-- index.html -->
<!doctype html>
<html lang="uk">
  <head>
    <meta charset="utf-8" />
    <title>Senti landing</title>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
      .wrap { max-width: 900px; margin: 0 auto; padding: 32px 16px 64px; }
      .card { background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 20px; padding: 24px; }
      h1 { font-size: 2.4rem; margin-bottom: 16px; }
      .btn { display: inline-block; margin-top: 16px; background: #38bdf8; color: #0f172a; padding: 10px 20px; border-radius: 999px; text-decoration: none; font-weight: 600; }
      .footer { margin-top: 48px; font-size: 0.75rem; color: #94a3b8; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>Senti — твій AI-помічник</h1>
        <p>Розуміє фото, текст, локацію. Працює у Telegram.</p>
        <a class="btn" href="https://t.me/your_senti_bot">Запустити в Telegram</a>
      </div>
      <p class="footer">© Senti. Згенеровано Codex.</p>
    </div>
  </body>
</html>
`,
};

export function getCodexTemplate(key) {
  const k = String(key || "").trim().toLowerCase();
  if (!k) return null;
  if (CODEX_TEMPLATES[k]) return CODEX_TEMPLATES[k];
  if (k === "tg" || k === "telegram") return CODEX_TEMPLATES["tg-bot"];
  if (k === "worker" || k === "cf") return CODEX_TEMPLATES["cf-worker"];
  if (k === "page" || k === "landing-page") return CODEX_TEMPLATES["landing"];
  return null;
}

export function listCodexTemplates() {
  return Object.keys(CODEX_TEMPLATES);
}