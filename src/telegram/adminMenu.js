// src/telegram/adminMenu.js
import { abs } from "../utils/url.js";
import { sendMessage } from "./helpers.js";

export async function sendAdminMenu({ env, chatId }) {
  const sec = encodeURIComponent(env.WEBHOOK_SECRET || "");
  const cl = abs(env, `/admin/checklist/html?s=${sec}`);
  const repo = abs(env, `/admin/repo/html?s=${sec}`);
  const hook = abs(env, "/webhook");

  const inline = {
    inline_keyboard: [
      [{ text: "📋 Checklist", url: cl }],
      [{ text: "📁 Repo", url: repo }],
      [{ text: "🌐 Webhook GET", url: hook }],
    ],
  };
  await sendMessage(env, chatId, "\u2060", { reply_markup: inline });
}
