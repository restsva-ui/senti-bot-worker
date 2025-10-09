// Простий чеклист + архіви поверх KV
// Використовує TODO_KV як сховище (ключі: checklist_md, archive:*)

const CHECK_KEY = "checklist_md";
const ARCHIVE_PREFIX = "archive:";

// ---------- текст чеклиста ----------
export async function getChecklistKV(env) {
  const v = await env.TODO_KV.get(CHECK_KEY);
  return v ?? "# Senti checklist\n";
}

export async function setChecklistKV(env, text) {
  await env.TODO_KV.put(CHECK_KEY, text ?? "");
  return true;
}

export async function appendChecklistKV(env, line) {
  const cur = await getChecklistKV(env);
  const next = (cur.endsWith("\n") ? cur : cur + "\n") + `- ${line}\n`;
  await setChecklistKV(env, next);
  return true;
}

// ---------- архіви ----------
export async function listArchivesKV(env, limit = 100) {
  const list = await env.TODO_KV.list({ prefix: ARCHIVE_PREFIX, limit });
  // повертаємо метадані з ключа
  const out = [];
  for (const k of list.keys) {
    try {
      const raw = await env.TODO_KV.get(k.name);
      const obj = JSON.parse(raw);
      out.push({
        key: k.name,
        name: obj.name,
        size: obj.size,
        ts: obj.ts,
        ct: obj.ct || "application/zip",
      });
    } catch {
      out.push({ key: k.name, name: k.name.slice(ARCHIVE_PREFIX.length), size: 0, ts: 0, ct: "application/zip" });
    }
  }
  // нові зверху
  out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return out;
}

export async function saveArchiveKV(env, file) {
  // file: {name, type, arrayBuffer()}
  const buf = await file.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  const meta = {
    name: sanitizeName(file.name || "archive.zip"),
    size: buf.byteLength,
    ts: Date.now(),
    ct: file.type || "application/zip",
    // сам вміст
    b64,
  };
  const key = `${ARCHIVE_PREFIX}${meta.ts}_${meta.name}`;
  await env.TODO_KV.put(key, JSON.stringify(meta));
  return { key, ...meta, b64: undefined };
}

export async function getArchiveKV(env, key) {
  if (!key?.startsWith(ARCHIVE_PREFIX)) throw new Error("invalid key");
  const raw = await env.TODO_KV.get(key);
  if (!raw) return null;
  const obj = JSON.parse(raw);
  const bin = Uint8Array.from(atob(obj.b64), c => c.charCodeAt(0));
  return {
    name: obj.name,
    size: obj.size,
    ct: obj.ct || "application/zip",
    buf: bin.buffer,
  };
}

function sanitizeName(n) {
  return String(n).replace(/[^\w.\-]+/g, "_").slice(0, 128) || "archive.zip";
}