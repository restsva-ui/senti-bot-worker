// Надійний парсер команд Telegram: /ai, /ai@Bot, /ai <текст>, /ai\n<текст>
export function parseAiCommand(text = "") {
  const s = String(text).trim();

  // /ai або /ai@YourBot
  const m = s.match(/^\/ai(?:@[\w_]+)?(?:\s+([\s\S]+))?$/i);
  if (!m) return null;

  const arg = (m[1] || "").trim();
  return { cmd: "ai", arg };
}
