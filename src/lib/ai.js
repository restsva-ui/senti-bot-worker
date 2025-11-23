//////////////////////////////
// ai.js — AI-модуль Senti
//////////////////////////////

import { STATUTE_SENTI } from "../config/consts.js";
import { spendEnergy } from "./energy.js";

export async function aiRespond(env, dialog) {
  const messages = [
    {
      role: "system",
      content: STATUTE_SENTI,
    },
    ...dialog,
  ];

  const r = await env.AI.run("@cf/meta/llama-3.2-11b-instruct", { messages });

  return r.response;
}

export async function aiVision(env, url) {
  const r = await env.AI.run("@cf/llama-vision-bge", {
    image: url,
    prompt:
      "Проаналізуй фото. Зроби 2-3 точні, лаконічні речення. Не вигадуй.",
  });

  return r.response;
}
