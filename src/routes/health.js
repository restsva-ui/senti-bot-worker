import { json } from "../lib/resp.js";

export function handleHealth(env) {
  return json({ ok: true, name: "senti-bot-worker" });
}