// src/telegram/api.ts
import { CFG } from "../config";

type Json = Record<string, unknown>;
type ReplyMarkup = {
  inline_keyboard?: Array<Array<{ text: string; callback_data: string }>>;
};

function tgUrl(method: string) {
  const base = CFG.apiBase || "https://api.telegram.org";
  return `${base}/bot${CFG.botToken}/${method}`;
}

async function call<T = any>(method: string, body: Json): Promise<T> {
  const res = await fetch(tgUrl(method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw