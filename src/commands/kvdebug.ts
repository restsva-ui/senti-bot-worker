// src/commands/kvdebug.ts
import { type Env } from "../config";
import { sendMessage } from "../telegram/api";

/**
 * Показати кілька ключів з KV (для діагностики).
 * Не обов'язковий для продакшену, але корисний під час тесту.
 */
export async function cmdKvList(env: Env, chatId: number) {
  if (!env.LIKES_KV) {
    await sendMessage(env, chatId, "❌ KV не прив'язаний");
    return;
  }

  // Спробуємо прочитати агрегатні лічильники та 1-2 юзерські голоси
  const counts = await env.LIKES_KV.get("likes:counts");
  const someUser1 = await env.LIKES_KV.get("likes:user:sample1");
  const someUser2 = await env.LIKES_KV.get("likes:user:sample2");

  const lines = [
    "<b>KV debug</b>",
    `counts: <code>${counts ?? "null"}</code>`,
    `user:sample1: <code>${someUser1 ?? "null"}</code>`,
    `user:sample2: <code>${someUser2 ?? "null"}</code>`,
  ].join("\n");

  await sendMessage(env, chatId, lines, { parse_mode: "HTML" });
}