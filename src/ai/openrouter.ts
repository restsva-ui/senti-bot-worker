// src/ai/openrouter.ts

export interface EnvOpenRouter {
  OPENROUTER_API_KEY?: string;
}

type ORMessage = { role: "system" | "user" | "assistant"; content: string };

const OR_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

// Конфіг за замовчуванням. Модель можна поміняти пізніше в одному місці.
const DEFAULT_OR_MODEL = "meta-llama/llama-3.1-70b-instruct";

export async function openrouterAskText(
  env: EnvOpenRouter,
  userText: string,
  opts?: { model?: string; systemPrompt?: string },
): Promise<string> {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OpenRouter: OPENROUTER_API_KEY is missing");
  }

  const model = opts?.model ?? DEFAULT_OR_MODEL;

  const messages: ORMessage[] = [];
  if (opts?.systemPrompt) {
    messages.push({ role: "system", content: opts.systemPrompt });
  }
  messages.push({ role: "user", content: userText });

  const r = await fetch(OR_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      // опціонально, але корисно для політик OpenRouter
      "HTTP-Referer": "https://github.com/your-org/your-repo",
      "X-Title": "senti-bot-worker",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
    }),
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`OpenRouter HTTP ${r.status}: ${txt || r.statusText}`);
  }

  const data: any = await r.json();
  const content =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.delta?.content ??
    "";

  if (!content) throw new Error("OpenRouter: empty completion");
  return content;
}