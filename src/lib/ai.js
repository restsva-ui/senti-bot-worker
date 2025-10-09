// src/lib/ai.js
export const AI = {
  async ask(env, { system="", prompt="", context=[] }) {
    // якщо нема ключа — відповідаємо чемно
    if (!env.GEMINI_API_KEY) {
      return "🤖 (Gemini не налаштовано) Додай GEMINI_API_KEY у Workers Secrets, і я відповідатиму розумно.";
    }

    const parts = [];
    if (system) parts.push(`SYSTEM:\n${system}`);
    if (context?.length) {
      parts.push("CONTEXT:\n" + context.map((c,i)=>`[${i+1}] ${c.title||c.id||"doc"}: ${c.snippet||""}`).join("\n"));
    }
    parts.push(`USER:\n${prompt}`);
    const content = parts.join("\n\n");

    // Простий виклик Gemini 1.5 текст (compatible JSON payload)
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key="+env.GEMINI_API_KEY, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: content }]}]
      })
    });
    const j = await r.json();
    const txt = j?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return txt.trim() || "(немає відповіді)";
  }
};