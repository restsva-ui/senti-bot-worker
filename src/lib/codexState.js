// src/lib/codexState.js
// Стан Codex у KV: простий сторедж проєктів користувача

import { nowIso } from "./state.js";

// Ключ у KV для пам'яті Codex
export const CODEX_MEM_KEY = (uid) => `codex:mem:${uid}`;

// Завантажити пам'ять Codex для користувача
export async function loadCodexMem(env, userId) {
  const raw = await env.STATE_KV.get(CODEX_MEM_KEY(userId));

  if (!raw) {
    return {
      projects: {},
      lastUsed: null,
      lastUpdated: nowIso(),
    };
  }

  try {
    const data = JSON.parse(raw);
    if (!data.projects) data.projects = {};
    if (!data.lastUpdated) data.lastUpdated = nowIso();
    return data;
  } catch (err) {
    console.error("Bad Codex mem, resetting", err);
    return {
      projects: {},
      lastUsed: null,
      lastUpdated: nowIso(),
    };
  }
}

// Зберегти пам'ять Codex для користувача
export async function saveCodexMem(env, userId, mem) {
  const safeMem = {
    projects: mem?.projects || {},
    lastUsed: mem?.lastUsed || null,
    lastUpdated: mem?.lastUpdated || nowIso(),
  };

  await env.STATE_KV.put(CODEX_MEM_KEY(userId), JSON.stringify(safeMem), {
    // тиждень TTL — Codex не буде жити вічно, але й не пропаде відразу
    expirationTtl: 60 * 60 * 24 * 7,
  });
}