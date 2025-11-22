// src/lib/codexUtils.js
// Утиліти для Codex

// Підібрати ім'я файлу для експорту Codex за мовою / розширенням
export function guessCodexFilename(langOrExt) {
  const l = (langOrExt || "").toLowerCase();

  if (l === "html") return "codex.html";
  if (l.startsWith("uk")) return "codex-uk.txt";
  if (l.startsWith("en")) return "codex-en.txt";
  if (l.startsWith("de")) return "codex-de.txt";

  if (l === "js" || l === "javascript") return "codex.js";
  if (l === "ts" || l === "typescript") return "codex.ts";
  if (l === "css") return "codex.css";
  if (l === "json") return "codex.json";
  if (l === "py" || l === "python") return "codex.py";

  // дефолт
  return "codex.txt";
}