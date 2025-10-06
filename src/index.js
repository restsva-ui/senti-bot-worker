import { notFound, text } from "./lib/resp.js";
import { handleHealth } from "./routes/health.js";
import { handleWebhook } from "./routes/webhook.js";
import { getChecklist, toMarkdown } from "./lib/checklist.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return handleHealth(env);
    }

    if (request.method === "GET" && url.pathname === "/checklist") {
      const list = await getChecklist(env);
      return text(toMarkdown(list), { headers: { "content-type": "text/markdown; charset=utf-8" } });
    }

    if (request.method === "POST" && url.pathname === "/webhook") {
      return handleWebhook(request, env);
    }

    return notFound();
  },
};