import webhook from "./routes/webhook.js";
import { drivePing, driveSaveFromUrl, driveList } from "./lib/drive.js";

function textResponse(text, status = 200, type = "text/plain") {
  return new Response(text, { status, headers: { "content-type": type } });
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function auth(url, env) {
  const key = url.searchParams.get("key");
  const ok = key && key === (env.WEBHOOK_SECRET ?? "");
  return ok;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // === Telegram webhook ===
    if (path === "/webhook" && request.method === "POST") {
      return await webhook(request, env, ctx);
    }

    // === Health ===
    if (path === "/ping") {
      return textResponse("pong 🟢");
    }

    // === Google Drive: прості тести з телефона (GET з ?key=...) ===

    // 1) Пінг доступності папки
    //    https://<host>/gdrive/ping?key=SECRET
    if (path === "/gdrive/ping" && request.method === "GET") {
      if (!auth(url, env)) return textResponse("forbidden", 403);
      try {
        await drivePing(env);
        return jsonResponse({ ok: true, msg: "Drive OK" });
      } catch (e) {
        return jsonResponse({ ok: false, error: String(e?.message || e) }, 500);
      }
    }

    // 2) Список останніх файлів (топ-10)
    //    https://<host>/gdrive/list?key=SECRET
    if (path === "/gdrive/list" && request.method === "GET") {
      if (!auth(url, env)) return textResponse("forbidden", 403);
      try {
        const files = await driveList(env, 10);
        return jsonResponse({ ok: true, files });
      } catch (e) {
        return jsonResponse({ ok: false, error: String(e?.message || e) }, 500);
      }
    }

    // 3) Зберегти файл за URL у Drive
    //    https://<host>/gdrive/save?key=SECRET&url=<file_url>&name=<optional_name>
    if (path === "/gdrive/save" && request.method === "GET") {
      if (!auth(url, env)) return textResponse("forbidden", 403);
      const fileUrl = url.searchParams.get("url");
      const name = url.searchParams.get("name") || "";
      if (!fileUrl) return jsonResponse({ ok: false, error: "missing url" }, 400);
      try {
        const res = await driveSaveFromUrl(env, fileUrl, name);
        return jsonResponse({ ok: true, saved: res });
      } catch (e) {
        return jsonResponse({ ok: false, error: String(e?.message || e) }, 500);
      }
    }

    // === Default ===
    return textResponse("Senti Worker Active");
  },
};