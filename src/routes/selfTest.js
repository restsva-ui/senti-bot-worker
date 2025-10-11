// src/routes/selfTest.js
import { appendChecklist } from "../lib/kvChecklist.js";

const json = (o, status = 200) =>
  new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

// Будуємо абсолютні посилання ВІД поточного origin і підклеюємо секрет
const withSecFrom = (env, baseOrigin, path) => {
  const u = new URL(path, baseOrigin);
  const s = env.WEBHOOK_SECRET || "";
  if (s) u.searchParams.set("s", s);
  return u.toString();
};

async function ping(href) {
  try {
    const r = await fetch(href, { method: "GET" });
    return { ok: r.ok, status: r.status };
  } catch (err) {
    return { ok: false, status: 0, error: String(err) };
  }
}

// короткі підказки по найтиповіших збоях
const diagnose = (name, { ok, status }) => {
  if (ok) return "";
  if (status === 401) return "Невірний або відсутній секрет (?s=...). Перевір WEBHOOK_SECRET.";
  if (status === 404) {
    switch (name) {
      case "health":
        return "Маршрут /health не обробляється. Перевір if (p === \"/\" || p === \"/health\").";
      case "webhook_get":
        return "GET /webhook має відповідати 200. Перевір блок Telegram webhook.";
      case "brain_current":
      case "brain_list":
        return "Маршрути /api/brain/*. Перевір handleBrainApi та порядок if (p.startsWith(\"/api/brain\")) у src/index.js.";
      case "admin_checklist_html":
        return "Маршрут /admin/checklist/html. Перевір handleAdminChecklist у src/index.js.";
      case "admin_repo_html":
        return "Маршрут /admin/repo/html. Перевір handleAdminRepo і що повертається r, а не змінна з помилкою.";
      case "admin_statut_html":
        return "Маршрут /admin/statut/html. Перевір handleAdminStatut.";
      default:
        return "404: маршрут не змонтовано або порядок умов у src/index.js не дозволяє до нього дійти.";
    }
  }
  if (status === 0) return "Fetch-помилка (мережа/SSL/таймаут). Спробуй ще раз або перевір доступність воркера.";
  return `Статус ${status}: перевір логіку у відповідному модулі.`;
};

export async function handleSelfTest(req, env, url) {
  if (url.pathname !== "/selftest/run" || req.method !== "GET") return null;

  // гарантуємо початковий слеш, щоб URL будувались коректно
  const mk = (path) => {
    const safePath = path.startsWith("/") ? path : `/${path}`;
    return withSecFrom(env, url.origin, safePath);
  };

  const targets = {
    health: mk("/health"),
    webhook_get: mk("/webhook"),
    brain_current: mk("/api/brain/current"),
    brain_list: mk("/api/brain/list"),
    admin_checklist_html: mk("/admin/checklist/html"),
    admin_repo_html: mk("/admin/repo/html"),
    admin_statut_html: mk("/admin/statut/html"),
  };

  const results = {};
  await Promise.all(
    Object.entries(targets).map(async ([name, href]) => {
      const pr = await ping(href);
      const hint = diagnose(name, pr);
      results[name] = { name, url: href, ...pr, hint };
    })
  );

  const allOk = Object.values(results).every((r) => r.ok);
  const parts = Object.values(results).map(
    (r) => `${r.name}:${r.ok ? "ok" : "fail"}(${r.status || "ERR"})`
  );

  const line =
    `${allOk ? "✅" : "❌"} selftest ${new Date().toISOString()} :: ` +
    parts.join(" | ");

  // Запис до чеклиста для історії
  await appendChecklist(env, line);

  // зведені дії, якщо щось впало
  const next_actions = allOk
    ? "Все ок ✅"
    : Object.values(results)
        .filter((r) => !r.ok && r.hint)
        .map((r) => `• ${r.name}: ${r.hint}`)
        .join("\n");

  return json({
    ok: allOk,
    summary: parts.join(" | "),
    results,
    origin: url.origin,
    secured: !!env.WEBHOOK_SECRET,
    checklist_line: line,
    next_actions,
  });
}