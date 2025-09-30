// +++ ДОДАТИ на рівні з іншими if (...) у handleDiagnostics
import { aiTextRouter, ok, err } from "./ai/providers"; // <--- не забудь імпорт на початку файлу

// ...
  if (url.pathname === "/ai-text") {
    try {
      const provider = url.searchParams.get("provider") || "gemini";
      const prompt = url.searchParams.get("prompt") || "Скажи 'привіт' одним словом.";
      const model  = url.searchParams.get("model") || undefined;

      const out = await aiTextRouter(env as any, provider, prompt, model);
      return ok({ ok: true, provider, model: out?.model, text: out.text, raw: out.raw });
    } catch (e) {
      return err(e);
    }
  }