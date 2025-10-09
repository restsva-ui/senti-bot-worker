// src/lib/ai.js
export const AI = {
  async ask(env, {system="", prompt, context=[]}) {
    if(!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");
    const model = env.OPENROUTER_MODEL_VISION ? "gemini-1.5-flash" : "gemini-1.5-flash"; // лишаємо flash
    const parts = [];
    if (system) parts.push({role:"user", parts:[{text:`[SYSTEM]\n${system}`}]});
    if (context?.length) {
      const ctxText = context.map((c,i)=>`[CTX #${i+1}] ${c}`).join("\n\n");
      parts.push({role:"user", parts:[{text: ctxText}]});
    }
    parts.push({role:"user", parts:[{text: prompt}]});

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "content-type":"application/json" },
      body: JSON.stringify({
        contents: parts,
        generationConfig: { temperature: 0.6, topK: 40, topP: 0.95, maxOutputTokens: 1024 }
      })
    });
    const d = await r.json();
    if(!r.ok) throw new Error(`Gemini: ${d.error?.message||r.statusText}`);
    const text = d.candidates?.[0]?.content?.parts?.map(p=>p.text).join("") || "";
    return text.trim();
  }
};