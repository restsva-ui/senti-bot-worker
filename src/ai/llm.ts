// Легка обгортка для OpenRouter (якщо раптом потрібно текстове LLM)
export type LLMOpts = {
  apiKey: string;
  model: string;
  system?: string;
};

export async function llmComplete(opts: LLMOpts, prompt: string): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Authorization": `Bearer ${opts.apiKey}`
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        opts.system ? { role: "system", content: opts.system } : undefined,
        { role: "user", content: prompt },
      ].filter(Boolean)
    })
  });
  const data = await res.json<any>().catch(() => ({}));
  const text = data?.choices?.[0]?.message?.content;
  return text || JSON.stringify(data);
}