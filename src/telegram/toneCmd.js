// src/telegram/toneCmd.js
import { getTone, setTone } from "../lib/tone.js";
import { tr } from "../lib/i18n.js";
import { sendMessage } from "./helpers.js";

export async function handleToneCommand({ env, chatId, lang, text }) {
  const arg = text.replace(/^\/tone(?:@[\w_]+)?/i, "").trim();
  if (!arg) {
    const cur = await getTone(env, chatId);
    await sendMessage(env, chatId, tr(lang, "tone_current", cur.mode, cur.value, cur.autoLast || ""));
    await sendMessage(env, chatId, tr(lang, "tone_help"));
    return;
  }
  if (/^(help|\?)$/i.test(arg)) { await sendMessage(env, chatId, tr(lang, "tone_help")); return; }
  const ok = await setTone(env, chatId, arg);
  await sendMessage(env, chatId, ok ? tr(lang, "tone_set_ok", arg) : tr(lang, "generic_error", "bad tone value"));
}
