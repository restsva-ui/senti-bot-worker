// src/diagnostics.ts
export interface DiagEnv {
  CF_VISION: string;
  CLOUDFLARE_API_TOKEN: string;
}

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Обробляє діагностичні GET-ендпоінти:
 *  - GET /ai-check     → перевірка прав токена (список моделей)
 *  - GET /vision-test  → тест виклику vision-моделі (чорний квадрат)
 * Повертає Response або null, якщо шлях не збігся.
 */
export async function handleDiagnostics(
  request: Request,
  env: DiagEnv,
  url: URL
): Promise<Response | null> {
  if (request.method !== "GET") return null;

  if (url.pathname === "/ai-check") {
    try {
      const resp = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/2cf6e316af8623546c95c0354bc3aa00/ai/models`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
          },
        }
      );
      const data = await resp.json().catch(() => ({}));
      return json(
        {
          ok: resp.ok,
          status: resp.status,
          data: Array.isArray(data?.result)
            ? { count: data.result.length, sample: data.result.slice(0, 3) }
            : data,
        },
        resp.ok ? 200 : 500
      );
    } catch (e: any) {
      return json({ ok: false, error: String(e) }, 500);
    }
  }

  if (url.pathname === "/vision-test") {
    try {
      const resp = await fetch(
        `${env.CF_VISION}/@cf/meta/llama-3.2-11b-vision-instruct`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: "Опиши це зображення двома словами.",
            image_url:
              "https://upload.wikimedia.org/wikipedia/commons/9/99/Black_square.jpg",
          }),
        }
      );
      const data = await resp.json().catch(() => ({}));
      return json({ ok: resp.ok, status: resp.status, data }, resp.ok ? 200 : 500);
    } catch (e: any) {
      return json({ ok: false, error: String(e) }, 500);
    }
  }

  return null;
}