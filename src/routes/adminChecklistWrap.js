// src/routes/adminChecklistWrap.js
import { html } from "../utils/http.js";
import { checklistHtml } from "../lib/kvChecklist.js";
import { abs } from "../utils/url.js";

export async function handleAdminChecklistWithEnergy(req, env, url){
  const list = await checklistHtml(env);
  const learn = new URL(abs(env, "/admin/learn/html"));
  if (env.WEBHOOK_SECRET) learn.searchParams.set("s", env.WEBHOOK_SECRET);
  const btn = `<p><a href="${learn}" style="display:inline-block;padding:8px 12px;border:1px solid #2a3a50;border-radius:10px;text-decoration:none">🧠 Навчання (Learn)</a></p>`;
  return html(btn + list);
}