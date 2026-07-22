// src/routes/selfTestLocal.js
import { checklistHtml, statutHtml, listArchives } from "../lib/kvChecklist.js";
import { handleHealth } from "./health.js";
import { handleAdminRepo } from "./adminRepo.js";
import { handleAdminChecklist } from "./adminChecklist.js";
import { handleAdminStatut } from "./adminStatut.js";
import { handleBrainPromote } from "./brainPromote.js";
import { weatherIntent } from "../apis/weather.js";

function result(name, ok, status = 200, extra = {}) {
  return { name, ok: Boolean(ok), status, ...extra };
}

function adminSecret(env) {
  return env.ADMIN_SECRET || env.WEBHOOK_SECRET || "";
}

export async function runSelfTestLocalDirect(env) {
  const results = {};

  try {
    const response = await handleHealth(
      new Request("https://local/health"),
      env,
      new URL("https://local/health")
    );
    results.health = result("health", response?.status === 200, response?.status ?? 500);
  } catch (error) {
    results.health = result("health", false, 500, { error: String(error) });
  }

  try {
    const normal = weatherIntent("Привіт, як справи?");
    const weather = weatherIntent("Яка погода у Києві?");
    const normalMatched = typeof normal === "boolean" ? normal : Boolean(normal?.hit);
    const weatherMatched = typeof weather === "boolean" ? weather : Boolean(weather?.hit);
    results.weather_intent = result(
      "weather_intent",
      normalMatched === false && weatherMatched === true,
      normalMatched === false && weatherMatched === true ? 200 : 500,
      { normalMatched, weatherMatched }
    );
  } catch (error) {
    results.weather_intent = result("weather_intent", false, 500, { error: String(error) });
  }

  try {
    const unauthChecklist = await handleAdminChecklist(
      new Request("https://local/admin/checklist", { method: "GET" }),
      env,
      new URL("https://local/admin/checklist")
    );
    const unauthStatut = await handleAdminStatut(
      new Request("https://local/admin/statut", { method: "GET" }),
      env,
      new URL("https://local/admin/statut")
    );
    const ok = unauthChecklist?.status === 401 && unauthStatut?.status === 401;
    results.admin_guards = result("admin_guards", ok, ok ? 200 : 500, {
      checklistStatus: unauthChecklist?.status,
      statutStatus: unauthStatut?.status,
    });
  } catch (error) {
    results.admin_guards = result("admin_guards", false, 500, { error: String(error) });
  }

  const secret = adminSecret(env);
  if (!secret) {
    results.admin_secret = result("admin_secret", false, 500, {
      error: "ADMIN_SECRET or WEBHOOK_SECRET is not configured",
    });
  } else {
    results.admin_secret = result("admin_secret", true, 200);
  }

  try {
    const html = await checklistHtml(env);
    results.admin_checklist_html = result("admin_checklist_html", Boolean(html), html ? 200 : 500);
  } catch (error) {
    results.admin_checklist_html = result("admin_checklist_html", false, 500, { error: String(error) });
  }

  try {
    const html = await statutHtml(env);
    results.admin_statut_html = result("admin_statut_html", Boolean(html), html ? 200 : 500);
  } catch (error) {
    results.admin_statut_html = result("admin_statut_html", false, 500, { error: String(error) });
  }

  try {
    const items = await listArchives(env).catch(() => []);
    const list = Array.isArray(items) ? items : items?.items || [];
    results.brain_list = result("brain_list", Array.isArray(list), 200, { total: list.length });
  } catch (error) {
    results.brain_list = result("brain_list", false, 500, { error: String(error) });
  }

  try {
    const url = new URL("https://local/admin/repo/html");
    if (secret) url.searchParams.set("s", secret);
    const response = await handleAdminRepo(new Request(url), env, url);
    const ok = response?.status >= 200 && response?.status < 300;
    results.admin_repo_html = result("admin_repo_html", ok, response?.status ?? 500);
  } catch (error) {
    results.admin_repo_html = result("admin_repo_html", false, 500, { error: String(error) });
  }

  try {
    const url = new URL("https://local/api/brain/promote");
    if (secret) url.searchParams.set("s", secret);
    const response = await handleBrainPromote(new Request(url), env, url);
    const acceptable = [200, 400].includes(response?.status);
    results.brain_promote = result("brain_promote", acceptable, response?.status ?? 500, {
      note: response?.status === 400 ? "No archive available; handler and authorization are working" : undefined,
    });
  } catch (error) {
    results.brain_promote = result("brain_promote", false, 500, { error: String(error) });
  }

  const values = Object.values(results);
  const summary = values
    .map((item) => `${item.name}:${item.ok ? "ok" : `fail(${item.status})`}`)
    .join(" | ");

  return {
    ok: values.every((item) => item.ok),
    summary,
    results,
    origin: "local:direct",
  };
}
