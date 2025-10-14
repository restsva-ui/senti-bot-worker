// [3/7] src/routes/webhook/media.js
import { driveSaveFromUrl } from "../../lib/drive.js";
import { getUserTokens } from "../../lib/userDrive.js";
import { spendEnergy } from "../../lib/energy.js";
import { energyLinks } from "./utils.js";

function pickPhoto(msg) {
  const a = msg.photo;
  if (!Array.isArray(a) || !a.length) return null;
  const ph = a[a.length - 1];
  return { type: "photo", file_id: ph.file_id, name: `photo_${ph.file_unique_id}.jpg` };
}
function detectAttachment(msg) {
  if (!msg) return null;
  if (msg.document) {
    const d = msg.document;
    return { type: "document", file_id: d.file_id, name: d.file_name || `doc_${d.file_unique_id}` };
  }
  if (msg.video)  { const v = msg.video;  return { type:"video",  file_id:v.file_id,  name:v.file_name  || `video_${v.file_unique_id}.mp4` }; }
  if (msg.audio)  { const a = msg.audio;  return { type:"audio",  file_id:a.file_id,  name:a.file_name  || `audio_${a.file_unique_id}.mp3` }; }
  if (msg.voice)  { const v = msg.voice;  return { type:"voice",  file_id:v.file_id,  name:`voice_${v.file_unique_id}.ogg` }; }
  if (msg.video_note) { const v = msg.video_note; return { type:"video_note", file_id:v.file_id, name:`videonote_${v.file_unique_id}.mp4` }; }
  return pickPhoto(msg);
}

async function tgFileUrl(env, file_id) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id }),
  });
  const d = await r.json().catch(() => ({}));
  const path = d?.result?.file_path;
  if (!path) throw new Error("getFile: file_path missing");
  return `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${path}`;
}

export async function handleIncomingMedia(env, TG, chatId, userId, msg) {
  const att = detectAttachment(msg);
  if (!att) return false;

  // списання енергії за медіа
  const spend = await spendEnergy(env, userId, Number(env.ENERGY_COST_IMAGE ?? 5), "media");
  if (spend.energy < 0 || spend.energy + 1 <= (Number(env.ENERGY_LOW_THRESHOLD ?? 10))) {
    const links = energyLinks(env, userId);
    await TG.text(chatId,
      `🔋 Недостатньо енергії для збереження медіа (потрібно ${env.ENERGY_COST_IMAGE ?? 5}).\n` +
      `Відновлюйся автоматично, або керуй тут:\n• Energy: ${links.energy}\n• Checklist: ${links.checklist}`
    );
    return true;
  }

  const ut = await getUserTokens(env, userId);
  if (!ut?.refresh_token) {
    const authUrl = `https://${env.SERVICE_HOST}/auth/start?u=${userId}`;
    await TG.text(chatId, `Щоб зберігати у свій Google Drive — спочатку дозволь доступ:\n${authUrl}\n\nПотім натисни «Google Drive» ще раз.`);
    return true;
  }

  const url = await tgFileUrl(env, att.file_id);
  const saved = await driveSaveFromUrl(env, userId, url, att.name);
  await TG.text(chatId, `✅ Збережено на твоєму диску: ${saved?.name || att.name}`);
  return true;
}