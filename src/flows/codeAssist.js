// src/flows/codeAssist.js
// Базовий кодовий режим Senti: дає план, файли і тести в одному виклику.
// Наступний крок — під’єднати це у webhook по тригеру ("зроби мені проект", "зроби код", "generate app").

import { askAnyModel } from "../lib/modelRouter.js";

const SYS = `You are Senti Code — autonomous senior fullstack developer.
- Generate production-ready code.
- Prefer Node.js/JS unless user asked otherwise.
- Always output FULL files.
- If project has multiple files — output as JSON array of {path,content}.
- Include minimal tests where reasonable.
- Do NOT say you are AI.`;

export async function generateProject(env, userPrompt, { lang = "uk" } = {}) {
  const order = env.CODE_MODEL_ORDER || env.MODEL_ORDER || "";
  const prompt =
    (lang.startsWith("uk")
      ? `Користувач хоче код/проєкт. Ось вимога:\n${userPrompt}\nВідповідай у форматі:\n{\n  "summary": "...",\n  "files": [ { "path": "...", "content": "..." } ],\n  "tests": [ { "path": "...", "content": "..." } ]\n}\nЯкщо щось неясно — зроби безпечну дефолтну структуру.`
      : `User wants a code/project. Requirement:\n${userPrompt}\nRespond in JSON with fields summary, files[], tests[].`);
  const out = await askAnyModel(env, order, prompt, { systemHint: SYS, temperature: 0.3 });
  return out;
}
