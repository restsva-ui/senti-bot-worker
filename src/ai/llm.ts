// src/ai/llm.ts
import type { Env } from "../config";

type Msg = { role: "system" | "user" | "assistant"; content: string };

function withGateway(env: Env, url: string) {
  // Якщо вкажеш CF_AI_GATEWAY_BASE, усі запити підуть через нього
  if (env.CF_AI_GATEWAY_BASE) {
    const base = env.CF_AI_GATEWAY_BASE.replace(/\/+$/,"");
    return `${base}/${url.replace(/^https?:\/\//, "")}`;
  }
  return url;
}

async function postJSON(url: string, headers: Record<string,string>, body: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type":"application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text().catch(()=> "")}`);
  return res.json();
}

export async function llmChat(env: Env, messages: Msg[], maxTokens = 400): Promise<string> {
  const provider = (env.AI_PROVIDER || "auto").toLowerCase();

  // -- 1) GROQ -------------------------------------------------
  if (provider === "groq" || provider === "auto") {
    if (env.GROQ_API_KEY) {
      const url = withGateway(env, "https://api.groq.com/openai/v1/chat/completions");
      const data = await postJSON(url,
        { authorization: `Bearer ${env.GROQ_API_KEY}` },
        {
          model: "llama-3.1-8b-instant", // швидко/дешево; при потребі підмінемо
          messages, temperature: 0.3, max_tokens: maxTokens,
        });
      return data?.choices?.[0]?.message?.content?.toString() ?? "";
    }
  }

  // -- 2) DeepSeek ---------------------------------------------
  if (provider === "deepseek" || provider === "auto") {
    if (env.DEEPSEEK_API_KEY) {
      const url = withGateway(env, "https://api.deepseek.com/chat/completions");
      const data = await postJSON(url,
        { authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
        {
          model: "deepseek-chat",
          messages, temperature: 0.3, max_tokens: maxTokens,
        });
      return data?.choices?.[0]?.message?.content?.toString() ?? "";
    }
  }

  // -- 3) Gemini -----------------------------------------------
  if (provider === "gemini" || provider === "auto") {
    if (env.GEMINI_API_KEY) {
      // спрощений сумісний формат
      const url = withGateway(env, `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`);
      const contents = messages.map(m => ({ role: m.role, parts: [{ text: m.content }] }));
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type":"application/json" },
        body: JSON.stringify({ contents }),
      });
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text().catch(()=> "")}`);
      const data = await res.json();
      const txt = data?.candidates?.[0]?.content?.parts?.map((p:any)=>p?.text).join("") || "";
      if (txt) return txt;
    }
  }

  // -- 4) OpenRouter (маркет) ----------------------------------
  if (provider === "openrouter" || provider === "auto") {
    if (env.OPENROUTER_API_KEY) {
      const url = withGateway(env, "https://openrouter.ai/api/v1/chat/completions");
      const model = env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct:free";
      const data = await postJSON(url,
        {
          authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          "X-Title": "senti-bot-worker",
        },
        { model, messages, temperature: 0.3, max_tokens: maxTokens }
      );
      return data?.choices?.[0]?.message?.content?.toString() ?? "";
    }
  }

  throw new Error("LLM: немає доступного провайдера/ключа");
}