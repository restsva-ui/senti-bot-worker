// src/diagnostics.ts
export interface DiagEnv {
  CF_VISION: string;               // напр.: https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/run
  CLOUDFLARE_API_TOKEN: string;    // API Token з правами Workers AI (Read + Run/Edit)
}

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Діагностичні GET-ендпоінти:
 *  - GET /token-verify  → перевіряє валідність самого API-токена (без AI)
 *  - GET /ai-check      → перевіряє доступ до каталогу AI-моделей (Workers AI)
 *  - GET /vision-test   → робить тестовий виклик vision-моделі (llama-3.2-11b-vision-instruct)
 *
 * Повертає Response або null, якщо шлях не збігся.
 */
export async function handleDiagnostics(
  request: Request,
  env: DiagEnv,
  url: URL
): Promise<Response | null> {
  if (request.method !== "GET") return null;

  // --- 1) Перевірка валідності токена (без AI пермісій)
  if (url.pathname === "/token-verify") {
    try {
      const resp = await fetch(
        "https://api.cloudflare.com/client/v4/user/tokens/verify",
        {
          method: "GET",
          headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
        }
      );
      const data = await resp.json().catch(() => ({}));
      return json(
        { ok: resp.ok, status: resp.status, data },
        resp.ok ? 200 : 500
      );
    } catch (e: any) {
      return json({ ok: false, error: String(e) }, 500);
    }
  }

  // --- 2) Перевірка доступу до списку AI-моделей (Workers AI)
  if (url.pathname === "/ai-check") {
    try {
      // Використовуємо account_id з CF_VISION, якщо він там є, інакше можна підставити свій
      // Але простіше: сформуємо абсолютний URL з відомим account_id
      const modelsUrl =
        "https://api.cloudflare.com/client/v4/accounts/2cf6e316af8623546c95c0354bc3aa00/ai/models";

      const resp = await fetch(modelsUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
      });

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

  // --- 3) Тест виклику vision-моделі (Workers AI → run)
  if (url.pathname === "/vision-test") {
    try {
      const runUrl = `${env.CF_VISION}/@cf/meta/llama-3.2-11b-vision-instruct`;
      const resp = await fetch(runUrl, {
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
      });

      const data = await resp.json().catch(() => ({}));
      return json(
        { ok: resp.ok, status: resp.status, data },
        resp.ok ? 200 : 500
      );
    } catch (e: any) {
      return json({ ok: false, error: String(e) }, 500);
    }
  }

  // Не наш шлях
  return null;
}