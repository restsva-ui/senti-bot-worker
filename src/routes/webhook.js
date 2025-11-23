//////////////////////////////
// webhook.js — Senti FINAL 3.0
//////////////////////////////

import { TG } from "../lib/tg.js";
import { aiRespond, aiVision } from "../lib/ai.js";
import { loadDialog, saveDialog } from "../lib/dialog.js";
import { getProfile, saveProfile } from "../lib/profile.js";
import { addReferral, getReferralStats } from "../lib/referrals.js";
import { giveEnergyBonus, getEnergy, spendEnergy } from "../lib/energy.js";
import { incMessages, incPhotos } from "../lib/stats.js";
import { addPhoto } from "../lib/photos.js";
import { json } from "../lib/utils.js";
import { kvGet, kvSet } from "../lib/kv.js";

export async function handleWebhook(req, env, ctx) {
  try {
    const update = await req.json();
    const tg = new TG(env.TG_TOKEN);

    const msg = update.message;
    const cb = update.callback_query;
    const web = msg?.web_app_data || update.web_app_data || null;

    if (web) return handleWebApp(web, tg, env);
    if (msg) {
      const uid = String(msg.from.id);
      let profile = await getProfile(env, uid) || {
        uid, lang:"uk", energy:30, premium:false, created:Date.now()
      };
      await saveProfile(env, profile);

      if (msg.photo) return handlePhoto(msg, tg, env, profile);
      if (msg.text?.startsWith("/start")) return handleStart(msg, tg, env, profile);
      if (msg.text==="/ref") return handleRef(msg, tg, env, profile);

      return handleDialog(msg, tg, env, profile);
    }

    if (cb) return handleCallback(cb, tg, env);
    return json({ok:true});

  } catch(e){
    return json({ok:false,error:String(e)},500);
  }
}
async function handleWebApp(web, tg, env){
  const p = JSON.parse(web.data||"{}");
  const uid = p.uid;

  if(p.action==="photo_analyze"){
    const base64 = await kvGet(env,p.uploadKey);
    await addPhoto(env,uid,base64);
    await incPhotos(env,uid);
    const r = await aiVision(env,base64);
    await spendEnergy(env,uid,5);
    await tg.sendMessage(uid,r);
    return json({ok:true});
  }

  if(p.action==="chat_msg"){
    await incMessages(env,uid);
    return json({ok:true});
  }

  if(p.action==="buy_energy"){
    const {amount} = p;
    await tg.sendInvoice(uid,{
      title:"Поповнення енергії",
      description:`+${amount} енергії`,
      payload:`buy_energy_${amount}`,
      provider_token:env.PAY_TOKEN,
      currency:"USD",
      prices:[{label:`Energy +${amount}`,amount:100}]
    });
    return json({ok:true});
  }

  if(p.action==="buy_premium"){
    await tg.sendInvoice(uid,{
      title:"Senti Premium",
      description:"Повний доступ",
      payload:`premium_sub`,
      provider_token:env.PAY_TOKEN,
      currency:"USD",
      prices:[{label:"Premium 1 month",amount:300}]
    });
    return json({ok:true});
  }
}
