// src/lib/providers/workersAi.js
// Обгортки для Cloudflare Workers AI (чат/візн/ASR/TTS).
// Не прив'язаний до глобальних ENV — ключі/айді приходять параметрами.

const CF_BASE = (accountId) => `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/`;

// ─────────────────────────────────────────────────────────────────────────────
// НИЗЬКОРІВНЕВИЙ ВИКЛИК

export async function callWorkersAI({ accountId, apiToken, model, inputs }) {
  if (!accountId) throw new Error("WorkersAI: missing accountId");
  if (!apiToken) throw new Error("WorkersAI: missing apiToken");
  if (!model) throw new Error("WorkersAI: missing model");

  const url = CF_BASE(accountId) + encodeURIComponent(model);
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(inputs ?? {})
  });

  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.success) {
    const errs = (j && j.errors) ? JSON.stringify(j.errors) : await r.text().catch(() => "");
    throw new Error(`WorkersAI ${r.status}: ${errs}`);
  }
  return j.result;
}

// ─────────────────────────────────────────────────────────────────────────────
// ВЕРХНІ РІВНІ — СПЕЦІАЛІЗОВАНІ ВИКЛИКИ

// 1) ЧАТ/ТЕКСТ (LLM інструктаж, код, reasoning)
export async function cfChat({ accountId, apiToken, model, messages, temperature = 0.2 }) {
  const res = await callWorkersAI({
    accountId, apiToken, model,
    inputs: { messages, temperature }
  });

  // CF моделі повертають різні поля залежно від провайдера.
  // Спробуємо витягнути текст максимально універсально.
  const text =
    res?.response ??
    res?.output_text ??
    res?.output?.text ??
    res?.result ??
    (Array.isArray(res?.choices) ? res.choices[0]?.message?.content : null) ??
    "";

  return { text, raw: res };
}

// 2) ВІЖН (image + текстовий промпт)
export async function cfVision({ accountId, apiToken, model, prompt, imageBase64 }) {
  // Формат вмісту узгоджений із CF прикладами: content = [{type:"input_text"}, {type:"input_image", image: base64}]
  const messages = [{
    role: "user",
    content: [
      { type: "input_text", text: prompt || "" },
      ...(imageBase64 ? [{ type: "input_image", image: imageBase64 }] : [])
    ]
  }];

  const res = await callWorkersAI({
    accountId, apiToken, model,
    inputs: { messages, temperature: 0.2 }
  });

  const text =
    res?.response ??
    res?.output_text ??
    res?.output?.text ??
    res?.result ??
    "";

  return { text, raw: res };
}

// 3) ASR (Whisper) — audio(base64) → transcript
export async function cfWhisper({ accountId, apiToken, model, audioBase64, format = "mp3" }) {
  const res = await callWorkersAI({
    accountId, apiToken, model,
    inputs: { audio: { buffer: audioBase64, format } }
  });

  // Зазвичай повертає { text: "..." } або подібне
  const text =
    res?.text ??
    res?.transcript ??
    res?.result ??
    res?.response ??
    "";

  return { text, raw: res };
}

// 4) TTS — text → audio (base64)
// Назва TTS-моделі залежить від каталогу Workers AI (перевір у changelog/каталозі).
export async function cfTTS({ accountId, apiToken, model, text, voice = "male" }) {
  const res = await callWorkersAI({
    accountId, apiToken, model,
    inputs: { text, voice }
  });

  // Прагнемо повернути base64 аудіо (CF часто повертає { audio: base64, format })
  const audioBase64 =
    res?.audio ??
    res?.output?.audio ??
    res?.result ??
    null;

  const format =
    res?.format ??
    res?.output?.format ??
    "mp3";

  if (!audioBase64) {
    throw new Error("WorkersAI TTS: no audio in result");
  }

  return { audioBase64, format, raw: res };
}
