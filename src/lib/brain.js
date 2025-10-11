// Мінімальний "мозок" Senti: спочатку пробує Gemini (v1), потім OpenRouter.
// Якщо ключів немає — м'який фолбек.

function normGemini(model) {
  return String(model || "gemini-1.5-flash").replace(/-latest$/i, "");
}

export async function think(env, userText, systemHint = "") {
  const text = String(userText || "").trim();
  if (!text) return "🤖 Дай мені текст або запитання — і я відповім.";

  // 1) Gemini v1
  const GEMINI_KEY = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (GEMINI_KEY) {
    try {
      const model = normGemini(env.GEMINI_MODEL || "gemini-1.5-flash");
      const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(
        model
      )}:generateContent?key=${GEMINI_KEY}`;

      const body = {
        contents: [
          {
            role: "user",
            parts: [{ text: systemHint ? `${systemHint}\n\n${text}` : text }],
          },
        ],
        generationConfig: { temperature: 0.6, maxOutputTokens: 1024 },
      };

      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        const out =
          j?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("") ||
          j?.candidates?.[0]?.content?.parts?.[0]?.text ||
          "";
        if (out) return out;
      } else {
        console.log("Gemini fail:", r.status, j);
      }
    } catch (e) {
      console.log("Gemini error:", e);
    }
  }

  // 2) OpenRouter як резерв
  if (env.OPENROUTER_API_KEY) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: env.OPENROUTER_MODEL || "deepseek/deepseek-chat",
          messages: [
            ...(systemHint ? [{ role: "system", content: systemHint }] : []),
            { role: "user", content: text },
          ],
          temperature: 0.7,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        const out = j?.choices?.[0]?.message?.content || "";
        if (out) return out;
      } else {
        console.log("OpenRouter fail:", r.status, j);
      }
    } catch (e) {
      console.log("OpenRouter error:", e);
    }
  }

  // 3) Фолбек
  return (
    "🧠 Поки що я працюю у легкому режимі без зовнішніх моделей.\n" +
    "Додай GEMINI_API_KEY/GOOGLE_API_KEY або OPENROUTER_API_KEY у воркер — і відповіді стануть «розумнішими»."
  );
}