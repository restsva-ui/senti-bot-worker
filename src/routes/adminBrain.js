// src/routes/adminBrain.js
import { SentiCore } from "../brain/sentiCore.js";

export async function handleAdminBrain(req, env, url) {
  const p = url.pathname;

  const needSecret = () =>
    env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET;

  const json = (o, status = 200) =>
    new Response(JSON.stringify(o, null, 2), {
      status,
      headers: { "content-type": "application/json" },
    });

  // ✅ landing: /admin/brain (щоб не було "fallback")
  if (p === "/admin/brain") {
    const base = `${url.origin}/admin/brain`;
    return json({
      ok: true,
      note: "Use endpoints below (add ?s=WEBHOOK_SECRET if configured).",
      endpoints: {
        snapshot: `${base}/snapshot`,
        check: `${base}/check`,
        boot: `${base}/boot`,
      },
      auth: env.WEBHOOK_SECRET ? "required via ?s=..." : "not required",
    });
  }

  // /admin/brain/boot
  if (p === "/admin/brain/boot") {
    if (needSecret()) return json({ ok: false, error: "unauthorized" }, 401);
    const r = await SentiCore.boot(env);
    return json({ ok: true, ...r });
  }

  // /admin/brain/check
  if (p === "/admin/brain/check") {
    if (needSecret()) return json({ ok: false, error: "unauthorized" }, 401);
    const r = await SentiCore.selfCheck(env);
    return json({ ok: true, ...r });
  }

  // /admin/brain/snapshot
  if (p === "/admin/brain/snapshot") {
    if (needSecret()) return json({ ok: false, error: "unauthorized" }, 401);
    const r = await SentiCore.snapshot(env);
    return json({ ok: true, ...r });
  }

  return null;
}