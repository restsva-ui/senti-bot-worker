// src/flows/visionDescribe.js
// Єдиний вхід для опису зображень у Senti.
// Логіка така:
// 1) будуються системні правила під мову (uk/en/de/ru) — з visionPolicy
// 2) будується юзерський промпт (якщо юзер щось питав про фото)
// 3) викликаємо askVision(...) з modelRouter → він уже сам йде по MODEL_ORDER_VISION
// 4) постобробка тексту, щоб прибрати зайве і нормалізувати "Текст на зображенні"

import { askVision } from "../lib/modelRouter.js";
import {
  buildVisionHintByLang,
  makeVisionUserPrompt,
  postprocessVisionText,
} from "./visionPolicy.js";

/**
 * @typedef {Object} DescribeOpts
 * @property {string} imageBase64 - base64 без префікса data:, чисті байти зображення
 * @property {string} [question] - що саме юзер питає про це фото
 * @property {string} [lang] - бажана мова відповіді ("uk" за замовчуванням)
 * @property {string} [userId] - id/username юзера (для логів/modelRouter)
 * @property {boolean} [trace] - чи повертати розширену діагностику
 */

/**
 * Головна функція опису зображення.
 * @param {any} env - середовище воркера (ENV з wrangler.toml)
 * @param {DescribeOpts} opts
 */
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

  // будуємо промпти з узгодженого файлу політик
  const systemPrompt = buildVisionHintByLang(lang);
  const userPrompt = makeVisionUserPrompt(question, lang);

  let visionResp = null;
  let provider = null;
  let raw = null;

  try {
    // askVision у тебе вже в modelRouter.js
    visionResp = await askVision(env, {
      imageBase64,
      systemPrompt,
      userPrompt,
      // дозволяємо воркеру задати свій порядок у wrangler.toml:
      // MODEL_ORDER_VISION = "gemini:..., cf:@cf/..."
      modelOrder: env?.MODEL_ORDER_VISION,
      userId,
    });

    if (visionResp) {
      provider = visionResp.provider || visionResp.model || null;
      raw = visionResp;
    }
  } catch (err) {
    // якщо навіть askVision впав — далі зробимо локальний фолбек
    console.warn("describeImage: askVision failed:", err);
  }
  // якщо ми щось отримали від askVision
  if (visionResp && (visionResp.text || visionResp.content)) {
    const rawText = visionResp.text || visionResp.content || "";
    const cleaned = postprocessVisionText(rawText);

    return trace
      ? {
          ok: true,
          text: cleaned,
          provider: provider || "vision-router",
          trace: {
            systemPrompt,
            userPrompt,
            raw,
          },
        }
      : {
          ok: true,
          text: cleaned,
          provider: provider || "vision-router",
        };
  }

  // ───────────────────────────────
  // ФОЛБЕК: спробувати напряму CF vision, якщо токен є
  // (іноді askVision може не зібратись, а CF у тебе налаштований)
  // ───────────────────────────────
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
                  // CF чекає data:... або url, даємо data:
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
              trace: {
                systemPrompt,
                userPrompt,
                cfRaw: cfJson,
              },
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

  // якщо не вийшло взагалі нічого
  return trace
    ? {
        ok: false,
        error: "VISION_FAILED",
        message: "Не вдалося проаналізувати зображення.",
        trace: {
          systemPrompt,
          userPrompt,
        },
      }
    : {
        ok: false,
        error: "VISION_FAILED",
        message: "Не вдалося проаналізувати зображення.",
      };
}
