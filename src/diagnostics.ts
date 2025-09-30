// src/diagnostics.ts
// Загальні діагностичні ендпоїнти + делегування в AI-діагностику.

import { ok, err } from "./ai/providers";
import { handleAIDiagnostics } from "./diagnostics-ai";

interface Env {
  CLOUDFLARE_API_TOKEN?: string;
  [k: string]: unknown;
}

export async function handleDiagnostics(
  request: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  const path = url.pathname;

  // Перевірка CF API токена
  // GET /cf/check
  if (request.method === "GET" && path === "/cf/check") {
    const token = env.CLOUDFLARE_API_TOKEN;
    if (!token) return err("Missing CLOUDFLARE_API_TOKEN", 400);

    try {
      const res = await fetch(
        "https://api.cloudflare.com/client/v4/user/tokens/verify",
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      return ok(data, res.status);
    } catch (e: any) {
      return err(e?.message || String(e), 500);
    }
  }

  // Делегування AI-маршрутів
  const ai = await handleAIDiagnostics(request, env, url);
  if (ai) return ai;

  // Якщо не ми — повертаємо управління вище
  return null;
}