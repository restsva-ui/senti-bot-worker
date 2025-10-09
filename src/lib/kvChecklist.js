// Робота з чеклістом та архівами у Cloudflare KV
// Використовує біндінг: env.TODO_KV
// Ключі:
//  - checklist.md        — сам чекліст (markdown/текст)
//  - archive/<ISO>__name — завантажені файли (arrayBuffer)

const CHECKLIST_KEY = "checklist.md";
const ARCHIVE_PREFIX = "archive/";

/** Прочитати чекліст (або повернути дефолт) */
export async function readChecklist(env) {
  const v = await env.TODO_KV.get(CHECKLIST_KEY);
  return v ?? "# Senti checklist\n";
}

/** Перезаписати весь чекліст */
export async function writeChecklist(env, body) {
  await env.TODO_KV.put(CHECKLIST_KEY, String(body ?? ""));
  return true;
}

/** Додати рядок до чекліста */
export async function appendChecklist(env, line) {
  const curr = await readChecklist(env);
  const entry = (line ?? "").toString().trim() || `tick ${new Date().toISOString()}`;
  const updated = `${curr.replace(/\s*$/, "")}\n- ${entry}\n`;
  await env.TODO_KV.put(CHECKLIST_KEY, updated);
  return updated.length;
}

/** Зберегти архів (File/Blob) у KV, повернути ключ */
export async function saveArchive(env, file) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("saveArchive: invalid file");
  }
  const buf = await file.arrayBuffer();
  const safeName = (file.name || "upload").replace(/[^\w.\-]+/g, "_");
  const key = `${ARCHIVE_PREFIX}${new Date().toISOString()}__${safeName}`;
  await env.TODO_KV.put(key, buf); // зберігаємо як ArrayBuffer
  return key;
}

/** Отримати архів як ArrayBuffer (за потреби) */
export async function getArchive(env, key) {
  return await env.TODO_KV.get(key, "arrayBuffer");
}

/** Згенерувати HTML-сторінку чекліста з формами */
export async function checklistHtml(env, s) {
  const body = await readChecklist(env);
  const esc = (t) =>
    String(t)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");

  const qs = `?s=${encodeURIComponent(s || "")}`;
  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8"/>
<title>Senti Checklist</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  body { font: 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 16px; }
  h1 { margin: 0 0 12px; font-weight: 700; }
  form { margin: 8px 0; display:inline-block; }
  input[type=text] { padding:6px 8px; width:280px; }
  textarea { width:100%; height:65vh; font: 14px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  button { padding:6px 12px; cursor:pointer; }
  .bar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:4px 0 12px; }
</style>
</head>
<body>
  <h1>📝 Senti checklist</h1>

  <div class="bar">
    <!-- Додати рядок -->
    <form action="/admin/checklist/append${qs}" method="post">
      <input type="text" name="line" placeholder="Додати рядок у чекліст…"/>
      <button type="submit">Append</button>
    </form>

    <!-- Завантажити архів -->
    <form action="/admin/checklist/upload${qs}" method="post" enctype="multipart/form-data">
      <input type="file" name="file" />
      <button type="submit">Upload</button>
    </form>

    <!-- Зберегти увесь текст -->
    <form action="/admin/checklist/save${qs}" method="post">
      <button type="submit">Зберегти цілком</button>
    </form>
  </div>

  <form action="/admin/checklist/save${qs}" method="post">
    <textarea name="body">${esc(body)}</textarea>
    <div style="margin-top:8px">
      <button type="submit">Зберегти цілком</button>
    </div>
  </form>
</body>
</html>`;
}