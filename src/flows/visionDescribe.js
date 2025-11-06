// src/flows/visionDescribe.js
import { askVision } from "../lib/modelRouter.js";
import {
  buildVisionHintByLang,
  makeVisionUserPrompt,
  postprocessVisionText,
} from "./visionPolicy.js";

export async function describeImage(env, opts = {}) {
  const {
    imageBase64,
    question = "",
    lang = "uk",
    userId = "anon",
    trace = false,
  } = opts;

  if (!imageBase64) {
    return {
      ok: false,
      error: "NO_IMAGE",
      message: "Не передано зображення для аналізу.",
    };
  }

  const systemPrompt = buildVisionHintByLang(lang);
  const userPrompt = makeVisionUserPrompt(question, lang);

  let visionResp = null;
  let provider = null;
  let raw = null;

  try {
    visionResp = await askVision(env, {
      imageBase64,
      systemPrompt,
      userPrompt,
      modelOrder: env?.MODEL_ORDER_VISION,
      userId,
    });
    if (visionResp) {
      provider = visionResp.provider || visionResp.model || null;
      raw = visionResp;
    }
  } catch (err) {
    console.warn("describeImage: askVision failed:", err);
  }

  if (visionResp && (visionResp.text || visionResp.content)) {
    const rawText = visionResp.text || visionResp.content || "";
    const cleaned = postprocessVisionText(rawText);
    return trace
      ? { ok: true, text: cleaned, provider: provider || "vision-router", trace: { systemPrompt, userPrompt, raw } }
      : { ok: true, text: cleaned, provider: provider || "vision-router" };
  }

  // фолбек на Cloudflare vision
  if (env?.CF_ACCOUNT_ID && env?.CLOUDFLARE_API_TOKEN) {
    try {
      const cfUrl =
        "https://api.cloudflare.com/client/v4/accounts/" +
        env.CF_ACCOUNT_ID +
        "/ai/run/@cf/meta/llama-3.2-11b-vision-instruct";

      const cfBody = {
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
      };

      const cfResp = await fetch(cfUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(cfBody),
      });

      if (cfResp.ok) {
        const cfJson = await cfResp.json();
        const out =
          cfJson?.result?.response ||
          cfJson?.result?.output ||
          cfJson?.result?.text ||
          "";
        const cleaned = postprocessVisionText(out);

        return trace
          ? {
              ok: true,
              text: cleaned,
              provider: "@cf/meta/llama-3.2-11b-vision-instruct",
              trace: { systemPrompt, userPrompt, cfRaw: cfJson },
            }
          : {
              ok: true,
              text: cleaned,
              provider: "@cf/meta/llama-3.2-11b-vision-instruct",
            };
      }
    } catch (err) {
      console.warn("describeImage: CF fallback failed:", err);
    }
  }

  return trace
    ? {
        ok: false,
        error: "VISION_FAILED",
        message: "Не вдалося проаналізувати зображення.",
        trace: { systemPrompt, userPrompt },
      }
    : {
        ok: false,
        error: "VISION_FAILED",
        message: "Не вдалося проаналізувати зображення.",
      };
}
