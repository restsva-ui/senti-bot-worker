// src/routes/ciDeploy.js
// Автолог зелених деплоїв → чеклист + Repo + позначка current_archive

import { appendChecklist, saveArchive } from "../lib/kvChecklist.js";

// ключ у KV для поточного "зеленого" архіву
const CURRENT_KEY = "current_archive";

export async function handleCiDeploy(req, env, url) {
  const json = (o, status = 200) =>
    new Response(JSON.stringify(o, null, 2), {
      status,
      headers: { "content-type": "application/json" },
    });

  const needSecret =
    env.WEBHOOK_SECRET &&
    url.searchParams.get("s") !== env.WEBHOOK_SECRET;

  if (needSecret)
    return json({ ok: false, error: "unauthorized" }, 401);

  try {
    const commit = url.searchParams.get("commit") || "unknown";
    const actor = url.searchParams.get("actor") || "ci";
    const deployId =
      url.searchParams.get("deploy") || env.DEPLOY_ID || "manual";
    const status = url.searchParams.get("status") || "ok";

    const note =
      (status === "ok" ? "✅" : "❌") +
      ` Deploy: ${deployId} — ${commit} by ${actor}`;

    // запис у чеклист
    await appendChecklist(env, note);

    // якщо деплой успішний — зберігаємо архів як snapshot
    if (status === "ok" && req.method === "POST") {
      const form = await req.formData().catch(() => null);
      const file = form?.get("file");
      if (file) {
        const key = await saveArchive(env, file);
        // фіксуємо як "current"
        await env.CHECKLIST_KV.put(CURRENT_KEY, key);
        await appendChecklist(env, `📦 Новий current: ${key}`);
      }
    }

    return json({ ok: true, logged: note });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}