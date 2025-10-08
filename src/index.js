// src/index.js
import { drivePing, driveList, driveSaveFromUrl, driveAppendLog } from "./lib/drive.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // --- Перевірка працездатності
      if (path === "/") {
        return new Response("Senti Worker Active", { status: 200 });
      }

      // --- Пінг до Google Drive
      if (path === "/gdrive/ping") {
        const r = await drivePing(env);
        return new Response(JSON.stringify(r, null, 2), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // --- Лістинг файлів у папці
      if (path === "/gdrive/list") {
        const token = await (await import("./lib/drive.js")).getAccessToken(env);
        const list = await driveList(env, token);
        return new Response(JSON.stringify(list, null, 2), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // --- Додати рядок у чекліст
      if (path.startsWith("/gdrive/add")) {
        const line = url.searchParams.get("q") || "без тексту";
        const token = await (await import("./lib/drive.js")).getAccessToken(env);
        await driveAppendLog(env, token, line);
        return new Response(JSON.stringify({ ok: true, added: line }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // --- Зберегти файл із URL
      if (path.startsWith("/gdrive/save")) {
        const fileUrl = url.searchParams.get("url");
        const name = url.searchParams.get("name") || "file.bin";
        const token = await (await import("./lib/drive.js")).getAccessToken(env);
        const res = await driveSaveFromUrl(env, token, fileUrl, name);
        return new Response(JSON.stringify({ ok: true, res }, null, 2), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // --- Fallback
      return new Response(JSON.stringify({ ok: false, error: "Not found" }), {
        headers: { "Content-Type": "application/json" },
        status: 404,
      });

    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: String(err) }), {
        headers: { "Content-Type": "application/json" },
        status: 500,
      });
    }
  },
};