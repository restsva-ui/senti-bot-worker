// src/ai/gemini.ts
export async function geminiText(prompt: string, env: Env, f: typeof fetch = fetch) {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is missing");
  const model = env.GEMINI_MODEL || "models/gemini-2.5-flash"; // дефолт, без зміни секретів

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`;

  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: String(prompt || "").slice(0, 4000) }]}],
    generationConfig: { temperature: 0.7, topP: 0.95, maxOutputTokens: 512 }
  });

  const resp = await f(url, { method: "POST", headers: { "content-type": "application/json" }, body });
  const raw = await resp.text();                // уникаємо "Unexpected end of JSON input"
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${raw || "empty body"}`);

  let data: any = raw ? JSON.parse(raw) : null;
  const parts = data?.candidates?.[0]?.content?.parts;
  const text =
    Array.isArray(parts) ? parts.map((p: any) => p?.text || "").join("") :
    data?.candidates?.[0]?.text || data?.text || "";

  if (!text) throw new Error("Gemini returned no text");
  return text.trim();
}