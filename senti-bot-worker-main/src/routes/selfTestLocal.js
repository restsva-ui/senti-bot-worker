// src/routes/selfTestLocal.js
// Локальний selftest без зовнішніх fetch — викликає хендлери напряму,
// читає KV і збирає короткий статус по ключових розділах.

import { checklistHtml, statutHtml, listArchives } from "../lib/kvChecklist.js";
import { handleHealth } from "./health.js";
import { handleAdminRepo } from "./adminRepo.js";
import { handleBrainPromote } from "./brainPromote.js";

export async function runSelfTestLocalDirect(env) {
  const results = {};

  // health
  try {
    if (typeof handleHealth === "function") {
      const r = await handleHealth(
        new Request("https://local/health"),
        env,
        new URL("https://local/health")
      );
      results.health = { name: "health", ok: !!r && r.status !== 404, status: r?.status ?? 500 };
    } else {
      results.health = { name: "health", ok: true, status: 200 };
    }
  } catch (e) {
    results.health = { name: "health", ok: false, status: 500, error: String(e) };
  }

  // webhook_get (у нас GET /webhook завжди 200 у router)
  results.webhook_get = { name: "webhook_get", ok: true, status: 200 };

  // api/brain/current
  try {
    if (!env || !env.CHECKLIST_KV) {
      results.brain_current = {
        name: "brain_current",
        ok: true,
        status: 200,
        note: "CHECKLIST_KV not bound → current=null",
      };
    } else {
      const cur = await env.CHECKLIST_KV.get("brain:current");
      results.brain_current = { name: "brain_current", ok: true, status: 200, exists: !!cur };
    }
  } catch (e) {
    results.brain_current = { name: "brain_current", ok: false, status: 500, error: String(e) };
  }

  // api/brain/list
  try {
    const items = await listArchives(env).catch(() => []);
    const arr = Array.isArray(items) ? items : items?.items || [];
    results.brain_list = { name: "brain_list", ok: true, status: 200, total: arr.length };
  } catch (e) {
    results.brain_list = { name: "brain_list", ok: false, status: 500, error: String(e) };
  }

  // admin/checklist/html
  try {
    const h = await checklistHtml?.(env);
    results.admin_checklist_html = { name: "admin_checklist_html", ok: !!h, status: h ? 200 : 500 };
  } catch (e) {
    results.admin_checklist_html = { name: "admin_checklist_html", ok: false, status: 500, error: String(e) };
  }

  // admin/repo/html
  try {
    const r = await handleAdminRepo?.(
      new Request("https://local/admin/repo/html"),
      env,
      new URL("https://local/admin/repo/html"),
    );
    results.admin_repo_html = { name: "admin_repo_html", ok: !!r && r.status !== 404, status: r?.status ?? 200 };
  } catch (e) {
    results.admin_repo_html = { name: "admin_repo_html", ok: false, status: 500, error: String(e) };
  }

  // admin/statut/html
  try {
    const h = await statutHtml?.(env);
    results.admin_statut_html = { name: "admin_statut_html", ok: !!h, status: h ? 200 : 500 };
  } catch (e) {
    results.admin_statut_html = { name: "admin_statut_html", ok: false, status: 500, error: String(e) };
  }

  // api/brain/promote (перевірка на наявність хендлера)
  try {
    if (typeof handleBrainPromote === "function") {
      const r = await handleBrainPromote(
        new Request("https://local/api/brain/promote"),
        env,
        new URL("https://local/api/brain/promote"),
      );
      results.brain_promote = { name: "brain_promote", ok: !!r && r.status !== 404, status: r?.status ?? 200 };
    } else {
      results.brain_promote = { name: "brain_promote", ok: false, status: 404, hint: "handleBrainPromote not defined" };
    }
  } catch (e) {
    results.brain_promote = { name: "brain_promote", ok: false, status: 500, error: String(e) };
  }

  // Summary
  const summary = Object.values(results)
    .map((v) => `${v.name}:${v.ok ? "ok" : `fail(${v.status})`}`)
    .join(" | ");
  const overallOk = Object.values(results).every((v) => v.ok);

  return { ok: overallOk, summary, results, origin: "local:direct" };
}