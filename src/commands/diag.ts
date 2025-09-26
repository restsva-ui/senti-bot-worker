// src/commands/diag.ts
import { CFG } from "../config";
import { sendMessage } from "../telegram/api";

export async function diag(chatId: number) {
  const lines: string[] = [];

  lines.push("🧪 *Діагностика Senti*");

  // TG
  lines.push("");
  lines.push(`Telegram API base: ${CFG.apiBase()}`);
  lines.push(`BOT_TOKEN: ${CFG.botToken() ? "✅" : "❌"}`);

  // Models
  lines.push("");
  lines.push("🎙 *Моделі:*");
  const orKeyOk = !!CFG.openrouterKey();
  lines.push(`OpenRouter key: ${orKeyOk ? "✅" : "❌"}`);
  lines.push(`OpenRouter model: ${CFG.openrouterModel()}`);
  lines.push(`OpenRouter vision: ${CFG.openrouterVisionModel()}`);

  // Other
  lines.push("");
  lines.push("⚙️ *Інше:*");
  lines.push(`CF AI Gateway: ${CFG.cfAIGatewayBase() ? "✅" : "❌"}`);
  lines.push(`OWNER_ID: ${CFG.ownerId() ?? "—"}`);

  // --- KV healthcheck (robust) ---
  let kvState = "❌";
  try {
    const kv = CFG.kv();
    if (kv) {
      const testKey = "__senti_kv_health__";
      const stamp = Date.now().toString();
      await kv.put(testKey, stamp, { expirationTtl: 60 });
      const got = await kv.get(testKey);
      if (got === stamp) kvState = "✅";
    }
  } catch (_e) {
    kvState = "❌";
  }
  lines.push(`KV STATE: ${kvState}`);

  await sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });
}