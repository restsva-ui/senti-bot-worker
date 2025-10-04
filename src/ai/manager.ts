import { llmComplete } from "./llm";

export async function aiCompleteViaOpenRouter(env: any, prompt: string) {
  if (!env.OPENROUTER_API_KEY || !env.OPENROUTER_MODEL) {
    return "OpenRouter не налаштований.";
  }
  return llmComplete(
    { apiKey: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL, system: "You are a helpful assistant." },
    prompt
  );
}