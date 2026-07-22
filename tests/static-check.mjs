import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [webhook, tg, checklist, statut, wrangler] = await Promise.all([
  read("src/routes/webhook.js"),
  read("src/lib/tg.js"),
  read("src/routes/adminChecklist.js"),
  read("src/routes/adminStatut.js"),
  read("wrangler.toml"),
]);

assert.match(webhook, /weatherMatched\(weather\)/, "weather intent must inspect the hit flag");
assert.match(webhook, /weatherText\(result\)/, "weather result must be converted to text");
assert.match(webhook, /typeof ctx\.waitUntil === "function"/, "webhook must tolerate a missing ExecutionContext");
assert.match(tg, /data\?\.ok === false/, "Telegram API errors must be checked");
assert.match(tg, /getWebhookInfo/, "getWebhook helper must exist");
assert.match(tg, /setWebhook/, "setWebhook helper must exist");
assert.match(checklist, /error: "unauthorized"/, "checklist route must require authorization");
assert.match(statut, /error: "unauthorized"/, "statut route must require authorization");
assert.doesNotMatch(wrangler, /^WEBHOOK_SECRET\s*=/m, "WEBHOOK_SECRET must not be committed");
assert.doesNotMatch(wrangler, /^TG_WEBHOOK_SECRET\s*=/m, "TG_WEBHOOK_SECRET must not be committed");
assert.doesNotMatch(wrangler, /^TELEGRAM_SECRET_TOKEN\s*=/m, "TELEGRAM_SECRET_TOKEN must not be committed");

console.log("Static regression checks passed.");
