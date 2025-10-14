// src/telegram/media.js
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { driveSaveFromUrl } from "../lib/drive.js";
import { tr } from "../lib/i18n.js";
import { sendMessage } from "./helpers.js";

function pickPhoto(msg) {
  const a = msg.photo;
  if (!Array.isArray(a) || !a.length) return null;
  const ph = a[a.length - 1];
  return { type: "photo", file_id: ph.file_id, name: `photo_${ph.file_unique_id}.jpg` };
}

function detectAttachment(msg) {
  if (!msg) return null;
  if (msg.document)  { const d = msg.document;  return { type: "document",  file_id: d.file_id, name: d.file_name || `doc_${d.file_unique_id}` }; }
  if (msg.video)     { const v = msg.video;     return { type: "video",     file_id: v.file_id, name: v.file_name || `video_${v.file_unique_id}.mp4` }; }
  if (msg.audio)     { const a = msg.audio;     return { type: "audio",     file_id: a.file_id, name: a.file_name || `audio_${a.file_unique_id}.mp3` }; }
  if (msg.voice)     { const v = msg.voice;     return { type: "voice",     file_id: v.file_id, name: `voice_${v.file_unique_id}.ogg` }; }
  if (msg.video_note){ const v = msg.video_note;return { type: "video_note", file_id: v.file_id, name: `videonote_${v.file_unique_id}.mp4` }; }
  return pickPhoto(msg);
}

async function tgFileUrl(env, file_id) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id }),
  });
  const d = await r.json().catch(() => ({}));
  const path = d?.result?.file_path;
  if (!path) throw new Error("getFile: file_path missing");
  return `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${path}`;
}

export async function handleIncomingMedia(env, chatId, userId, msg, lang) {
  const att = detectAttachment(msg);
  if (!att) return false;

  const info = await getEnergy(env, userId);
  const { costImage } = info;
  if (info.energy < costImage) {
    const { energy, checklist } = (await import("./ui.js")).then ? await (await import("./ui.js")).energyLinks(env, userId) : {};
    const links = { energy, checklist };
    await sendMessage(env, chatId, tr(lang, "energy_not_enough", costImage, links));
    return true;
  }
  await spendEnergy(env, userId, costImage, "media");

  const ut = await getUserTokens(env, userId);
  if (!ut?.refresh_token) {
    const authUrl = abs(env, `/auth/start?u=${userId}`);
    await sendMessage(env, chatId, tr(lang, "drive_auth", authUrl));
    return true;
  }
  const url = await tgFileUrl(env, att.file_id);
  const saved = await driveSaveFromUrl(env, userId, url, att.name);
  await sendMessage(env, chatId, tr(lang, "saved_to_drive", saved?.name || att.name));
  return true;
}
