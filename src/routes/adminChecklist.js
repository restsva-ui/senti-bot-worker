// src/routes/adminChecklist.js
import {
  readChecklist, writeChecklist, appendChecklist, checklistHtml,
  saveArchive
} from "../lib/kvChecklist.js";
import { abs } from "../utils/url.js";

export async function handleAdminChecklist(req, env, url) {
  const p = url.pathname;
  const needSecret = () => (env.WEBHOOK_SECRET && (url.searchParams.get("s") !== env.WEBHOOK_SECRET));
  const html = (s)=> new Response(s, {headers:{ "content-type":"text/html; charset=utf-8" }});
  const json = (o, status=200)=> new Response(JSON.stringify(o,null,2), {status, headers:{ "content-type":"application/json" }});

  // /admin/checklist/html  (GET + POST form)
  if (p === "/admin/checklist/html") {
    if (needSecret()) return html("<h3>401</h3>");
    if (req.method === "POST") {
      const ct = req.headers.get("content-type") || "";
      if (!/form/.test(ct)) return json({ ok:false, error:"unsupported content-type" }, 415);
      const form = await req.formData();
      const mode = (url.searchParams.get("mode")||"").toLowerCase();
      if (mode === "replace") {
        await writeChecklist(env, String(form.get("full") ?? ""));
      } else {
        const line = String(form.get("line")||"").trim();
        if (line) await appendChecklist(env, line);
      }
    }
    const text = await readChecklist(env);
    return checklistHtml({ text, submitPath: abs(env,"/admin/checklist/html"), secret: env.WEBHOOK_SECRET || "" });
  }

  // /admin/checklist (JSON API)
  if (p === "/admin/checklist") {
    if (needSecret()) return json({ ok:false, error:"unauthorized" }, 401);
    if (req.method === "POST") {
      const body = await req.json().catch(()=>({}));
      const line = (body.line || "").toString().trim();
      if (!line) return json({ ok:false, error:"line required" }, 400);
      const add = await appendChecklist(env, line);
      return json({ ok:true, added:add });
    }
    const text = await readChecklist(env);
    return json({ ok:true, text });
  }

  // /admin/checklist/upload (multipart → save to Repo & append link)
  if (p === "/admin/checklist/upload" && req.method === "POST") {
    if (needSecret()) return json({ ok:false, error:"unauthorized" }, 401);
    const form = await req.formData();
    const file = form.get("file");
    if (!file) return json({ ok:false, error:"file required" }, 400);
    const key = await saveArchive(env, file);
    const urlKey = encodeURIComponent(key);
    const who = url.searchParams.get("who") || "";
    const note = `upload: ${(file.name||"file")} (${file.size||"?"} bytes) → /admin/archive/get?key=${urlKey}` +
                 `${env.WEBHOOK_SECRET?`&s=${encodeURIComponent(env.WEBHOOK_SECRET)}`:""}` +
                 `${who?`&who=${encodeURIComponent(who)}`:""}`;
    await appendChecklist(env, note);
    return Response.redirect(
      abs(env, `/admin/checklist/html${env.WEBHOOK_SECRET?`?s=${encodeURIComponent(env.WEBHOOK_SECRET)}`:""}`),
      302
    );
  }

  return null; // не наш маршрут
}