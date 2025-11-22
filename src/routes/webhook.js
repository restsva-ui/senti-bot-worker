// ---------------------------------------------
// Senti Webhook v3.0 (A2 clean API, fully stable)
// ---------------------------------------------

import { Router } from 'itty-router'

// Core AI modules
import { askAnyModel } from '../lib/modelRouter.js'
import { describeImage } from '../flows/visionDescribe.js'

// Learn system
import { buildDialogHint, pushTurn } from '../lib/dialogMemory.js'
import { loadSelfTune, autoUpdateSelfTune } from '../lib/selfTune.js'
import { getRecentInsights } from '../lib/kvLearnQueue.js'

// Codex modules
import { saveCodexMem } from '../lib/codexState.js'
import { guessCodexFilename } from '../lib/codexUtils.js'

// TG
import { TG } from '../lib/tg.js'

// Utils
import { json } from '../lib/utils.js'
import { abs } from '../utils/url.js'
import { getEnergy, spendEnergy } from '../lib/energy.js'

// Geo
import { detectLandmarksFromText, formatLandmarkLines } from '../lib/landmarkDetect.js'
import { weatherIntent, weatherSummaryByPlace, weatherSummaryByCoords } from '../apis/weather.js'
import { dateIntent, timeIntent, replyCurrentDate, replyCurrentTime } from '../apis/time.js'
import { setUserLocation, getUserLocation } from '../lib/geo.js'

// ---------------------------------------------
// Router
// ---------------------------------------------

const router = Router()

// ---------------------------------------------
// GET "/" — щоб не було "Not found"
// ---------------------------------------------

router.get('/', () => {
    const html = `
    <html>
      <head><title>Senti Worker</title></head>
      <body style="font-family: Arial; padding: 40px;">
        <h1>Senti Worker is running</h1>
        <p>Webhook endpoint is active.</p>
      </body>
    </html>`
    return new Response(html, { headers: { 'content-type': 'text/html' } })
})

// ---------------------------------------------
// POST "/webhook"
// ---------------------------------------------

router.post('/webhook', async (req, env) => {
    // Перевірка секрету Telegram
    const expected = env.WEBHOOK_SECRET || env.TELEGRAM_SECRET_TOKEN || ''
    if (expected) {
        const sec = req.headers.get("x-telegram-bot-api-secret-token")
        if (sec !== expected) {
            return json({ ok: false, error: "unauthorized" }, 401)
        }
    }

    // Парс апдейта
    const update = await req.json()
    return handleTelegramUpdate(update, env)
})

// ---------------------------------------------
// Експорт Worker
// ---------------------------------------------

export default {
    fetch: (req, env) => router.handle(req, env)
}
// ---------------------------------------------
// Part 2/5 — Telegram helpers + update parser
// ---------------------------------------------

// -----------------------------
// TG Token helper
// -----------------------------
function tgToken(env) {
    return env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN
}

// -----------------------------
// Send plain text
// -----------------------------
async function sendPlain(env, chatId, text, extra = {}) {
    const token = tgToken(env)
    if (!token) return null

    const body = {
        chat_id: chatId,
        text,
        ...extra
    }

    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
    })

    try {
        return await r.json()
    } catch {
        return null
    }
}

// -----------------------------
// Send typing animation
// -----------------------------
async function sendTyping(env, chatId) {
    const token = tgToken(env)
    if (!token) return

    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            action: "typing"
        })
    })
}

function pulseTyping(env, chatId, cycles = 3, interval = 3500) {
    sendTyping(env, chatId)
    for (let i = 1; i < cycles; i++) {
        setTimeout(() => sendTyping(env, chatId), i * interval)
    }
}

// -----------------------------
// Edit message text
// -----------------------------
async function editMessageText(env, chatId, messageId, text) {
    const token = tgToken(env)
    if (!token) return

    await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            text
        })
    })
}

// -----------------------------
// Send file/document
// -----------------------------
async function sendDocument(env, chatId, filename, content, caption) {
    const token = tgToken(env)
    if (!token) return

    const fd = new FormData()
    fd.append("chat_id", String(chatId))

    const file = new File([content], filename, { type: "text/plain" })
    fd.append("document", file)
    if (caption) fd.append("caption", caption)

    await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
        method: "POST",
        body: fd
    })
}

// -----------------------------
// getFile → real URL
// -----------------------------
async function tgFileUrl(env, file_id) {
    const token = tgToken(env)
    const r = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file_id })
    })

    const data = await r.json().catch(() => null)
    if (!data?.ok) throw new Error("getFile failed")

    const path = data.result?.file_path
    if (!path) throw new Error("file_path missing")

    return `https://api.telegram.org/file/bot${token}/${path}`
}

// -----------------------------
// Download as base64
// -----------------------------
async function urlToBase64(url) {
    const r = await fetch(url)
    if (!r.ok) throw new Error("download failed")

    const buf = await r.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ""

    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
}

// -----------------------------
// Parse media from Telegram msg
// -----------------------------
function detectPhoto(msg) {
    const photos = msg?.photo
    if (!photos || photos.length === 0) return null

    const sorted = [...photos].sort((a, b) => (a.file_size || 0) - (b.file_size || 0))
    const ph = sorted[sorted.length - 1]

    return {
        type: "photo",
        file_id: ph.file_id,
        name: `photo_${ph.file_unique_id}.jpg`
    }
}

function detectDocument(msg) {
    if (!msg?.document) return null
    return {
        type: "document",
        file_id: msg.document.file_id,
        name: msg.document.file_name || `doc_${msg.document.file_unique_id}`
    }
}

function detectVideo(msg) {
    if (!msg?.video) return null
    return {
        type: "video",
        file_id: msg.video.file_id,
        name: `video_${msg.video.file_unique_id}.mp4`
    }
}

function detectAnyMedia(msg) {
    return detectDocument(msg) || detectPhoto(msg) || detectVideo(msg) || null
}

// -----------------------------
// Normalize Telegram update
// -----------------------------
async function handleTelegramUpdate(update, env) {
    const msg = update.message || update.edited_message || update.channel_post
    if (!msg) return json({ ok: true })

    const chatId = msg.chat?.id
    const userId = msg.from?.id
    const textRaw = String(msg.text || msg.caption || "").trim()
    const lang = msg.from?.language_code || "uk"

    return handleSentiMessage({ msg, chatId, userId, textRaw, lang }, env)
}
// ---------------------------------------------
// Part 3/5 — VISION HANDLER (describe, OCR, map)
// ---------------------------------------------

async function handleVision(env, ctx) {
    const { msg, chatId, userId, textRaw, lang } = ctx

    // Якщо немає фото — не Vision
    const photo = detectPhoto(msg)
    if (!photo) return false

    // Vision працює тільки якщо Codex вимкнений
    if (await getCodexMode(env, userId)) return false

    const energy = await getEnergy(env, userId)
    const need = Number(energy.costText ?? 1)

    if ((energy.energy ?? 0) < need) {
        await sendPlain(env, chatId, "⚠️ Недостатньо енергії для аналізу фото.")
        return true
    }
    await spendEnergy(env, userId, need, "vision")

    // Завантажуємо фото
    const url = await tgFileUrl(env, photo.file_id)
    const base64 = await urlToBase64(url)

    // Тип запиту
    const lower = textRaw.toLowerCase()

    const wantsOCR =
        lower.includes("перепиши") ||
        lower.includes("скопіювати") ||
        lower.includes("копі") ||
        lower.includes("ocr") ||
        lower.includes("витягни текст")

    const wantsMap =
        lower.includes("покажи на карті") ||
        lower.includes("де це") ||
        lower.includes("що це за місце")

    const isPrompt = !!textRaw && !wantsOCR && !wantsMap

    // Промпт Vision
    let visionPrompt = ""

    if (wantsOCR) {
        visionPrompt = lang.startsWith("uk")
            ? "Випиши чистий текст з цього зображення. Без пояснень. Лише текст."
            : "Transcribe the text from this image. No explanation. Only raw text."
    } else if (isPrompt) {
        visionPrompt = textRaw
    } else {
        visionPrompt = lang.startsWith("uk")
            ? "Опиши, що зображено, коротко і точно."
            : "Describe this image briefly and precisely."
    }

    // Thinking animation
    pulseTyping(env, chatId)

    // Виклик Vision моделей
    const { text } = await describeImage(env, {
        chatId,
        tgLang: lang,
        imageBase64: base64,
        question: visionPrompt,
        modelOrder: "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-vision-instruct"
    })

    let result = String(text || "").trim()

    // OCR — повертаємо тільки текст
    if (wantsOCR) {
        await sendPlain(env, chatId, result)
        return true
    }

    // Vision опис
    await sendPlain(env, chatId, result)

    // Можливо знайти лендмарки
    const landmarks = detectLandmarksFromText(result, lang)

    if (landmarks?.length) {
        const lines = formatLandmarkLines(landmarks, lang)
        await sendPlain(env, chatId, lines.join("\n"), {
            parse_mode: "HTML",
            disable_web_page_preview: true
        })
    }

    // "Покажи на карті"
    if (wantsMap && landmarks?.length) {
        const first = landmarks[0]
        const q = encodeURIComponent(first.name)
        const gm = `https://www.google.com/maps/search/?api=1&query=${q}`

        await sendPlain(env, chatId, `🗺️ Місце на карті:\n${gm}`, {
            disable_web_page_preview: false
        })
    }

    return true
}
// ---------------------------------------------
// Part 4/5 — CODEX HANDLER (clean & stable)
// ---------------------------------------------

// KV flags
async function getCodexMode(env, uid) {
    const kv = env.STATE_KV || env.CHECKLIST_KV
    if (!kv) return false
    return (await kv.get(`codex:mode:${uid}`, 'text')) === 'on'
}

async function setCodexMode(env, uid, on) {
    const kv = env.STATE_KV || env.CHECKLIST_KV
    if (!kv) return
    await kv.put(`codex:mode:${uid}`, on ? 'on' : 'off')
}

// Clean animation (text frames)
async function codexAnimation(env, chatId, messageId, signal) {
    const frames = [
        "🧩 Codex: аналізую задачу…",
        "🧩 Codex: проектую рішення…",
        "🧩 Codex: генерую код…",
        "🧩 Codex: фіналізую файл…"
    ]

    let i = 0
    while (!signal.done) {
        await new Promise(r => setTimeout(r, 1500))
        if (signal.done) break
        await editMessageText(env, chatId, messageId, frames[i % frames.length])
        i++
    }
}

// Clean plain-text extraction from model
function extractText(res) {
    if (!res) return ""
    if (typeof res === "string") return res.trim()

    if (res.output_text) return String(res.output_text).trim()
    if (res.text) return String(res.text).trim()

    const msg = res.choices?.[0]?.message?.content
    if (typeof msg === "string") return msg.trim()

    if (Array.isArray(msg)) {
        return msg
            .filter(p => p.type === "text")
            .map(p => p.text)
            .join("\n")
            .trim()
    }

    return ""
}

// ---------------------------------------------
// handleCodex(env, ctx)
// ---------------------------------------------
async function handleCodex(env, ctx) {
    const { msg, chatId, userId, textRaw, lang } = ctx

    // Codex mode must be ON
    if (!(await getCodexMode(env, userId))) return false

    // Codex does NOT process photos (Vision handles this)
    if (detectPhoto(msg)) {
        await sendPlain(env, chatId, "📸 Надішли текстове завдання для Codex.")
        return true
    }

    if (!textRaw) return true

    // Special commands (optional)
    if (textRaw === "/codex_off") {
        await setCodexMode(env, userId, false)
        await sendPlain(env, chatId, "🧩 Codex вимкнено.")
        return true
    }

    // Codex task
    const systemHint =
        "You are Senti Codex — an AI software architect. " +
        "Your job is to generate clean, ready-to-run code. " +
        "Output ONLY code without commentary unless explicitly asked."

    const status = await sendPlain(env, chatId, "🧩 Codex працює…")
    const messageId = status?.result?.message_id
    const signal = { done: false }

    if (messageId) codexAnimation(env, chatId, messageId, signal)

    // AI model call
    const order =
        env.CODEX_MODEL_ORDER ||
        env.MODEL_ORDER ||
        "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-instruct"

    const res = await askAnyModel(env, order, textRaw, { systemHint })
    let raw = extractText(res)
    raw = raw.trim()

    signal.done = true

    // Decide filename
    let filename = guessCodexFilename("txt")

    const isHTML =
        /<!DOCTYPE\s+html/i.test(raw) ||
        /<html[^>]*>/i.test(raw)

    if (isHTML) filename = guessCodexFilename("html")

    // Save to Codex memory (for history browsing)
    await saveCodexMem(env, userId, { filename, content: raw })

    await sendPlain(
        env,
        chatId,
        isHTML ? "Готово! Надсилаю HTML файл." : "Готово! Надсилаю файл."
    )

    await sendDocument(env, chatId, filename, raw)

    return true
}
// ---------------------------------------------
// Part 5/5 — LEARN MODE + MAIN AI handler + ROUTING
// ---------------------------------------------

// -----------------------------
// Learn flags
// -----------------------------
async function getLearnMode(env, uid) {
    const kv = env.STATE_KV || env.CHECKLIST_KV
    if (!kv) return false
    return (await kv.get(`learn:mode:${uid}`, 'text')) === 'on'
}

async function setLearnMode(env, uid, on) {
    const kv = env.STATE_KV || env.CHECKLIST_KV
    if (!kv) return
    await kv.put(`learn:mode:${uid}`, on ? 'on' : 'off')
}

// -----------------------------
// MAIN AI RESPONSE (Senti dialog)
// -----------------------------
async function handleAiDialog(env, ctx) {
    const { chatId, userId, textRaw, lang } = ctx

    const systemCore =
        "You are Senti — a personal AI assistant. " +
        "Reply clearly, thoughtfully, without emojis unless needed. " +
        "Be concise but meaningful."

    const dialogHint = await buildDialogHint(env, userId)
    const selfTune = await loadSelfTune(env, chatId, { preferredLang: lang }).catch(() => "")
    const insightsArr = await getRecentInsights(env, userId, 5).catch(() => [])

    let insightsBlock = ""
    if (insightsArr?.length) {
        insightsBlock =
            "[Learned Knowledge]\n" +
            insightsArr.map(i => `• ${i.insight}`).join("\n")
    }

    const system =
        [systemCore, dialogHint, selfTune, insightsBlock]
            .filter(Boolean)
            .join("\n\n")

    // energy check
    const energy = await getEnergy(env, userId)
    const need = Number(energy.costText ?? 1)

    if ((energy.energy ?? 0) < need) {
        await sendPlain(env, chatId, "⚠️ Недостатньо енергії.")
        return true
    }
    await spendEnergy(env, userId, need, "dialog")

    pulseTyping(env, chatId)

    // AI model call
    const order =
        env.MODEL_ORDER ||
        "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-instruct"

    const { aiRespond } = await import('../flows/aiRespond.js')
    let out = await aiRespond(env, {
        text: textRaw,
        lang,
        name: "friend",
        systemHint: system,
        expand: false
    })

    // Normalize out
    if (typeof out === "object" && out !== null) {
        out = out.full || out.short || JSON.stringify(out)
    }
    out = String(out || "").trim()

    await pushTurn(env, userId, textRaw, out)

    // auto-learn
    if (await getLearnMode(env, userId)) {
        try {
            await autoUpdateSelfTune(env, userId)
        } catch { }
    }

    await sendPlain(env, chatId, out)
    return true
}

// ---------------------------------------------
// MAIN MESSAGE ROUTING
// ---------------------------------------------
async function handleSentiMessage(ctx, env) {
    const { msg, chatId, userId, textRaw, lang } = ctx

    // ----- /start -----
    if (textRaw === "/start") {
        await setCodexMode(env, userId, false)
        await setLearnMode(env, userId, true)

        await sendPlain(env, chatId,
            "Привіт! Я Senti. Готовий допомагати.",
            { reply_markup: TG.mainKeyboard(true) }
        )
        return json({ ok: true })
    }

    // ----- Buttons -----
    if (textRaw === TG.BTN_CODEX) {
        await setCodexMode(env, userId, true)
        await sendPlain(env, chatId, "🧩 Codex увімкнено. Надішли задачу.")
        return json({ ok: true })
    }

    if (textRaw === "/codex_off") {
        await setCodexMode(env, userId, false)
        await sendPlain(env, chatId, "🧩 Codex вимкнено.")
        return json({ ok: true })
    }

    if (textRaw === TG.BTN_ADMIN) {
        const checklist = abs(env, "/admin/checklist")
        const learn = abs(env, "/admin/learn")

        await sendPlain(env, chatId, "Admin panel:", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📋 Checklist", url: checklist }],
                    [{ text: "🧠 Learn", url: learn }]
                ]
            }
        })
        return json({ ok: true })
    }

    if (textRaw === "/learn_on") {
        await setLearnMode(env, userId, true)
        await sendPlain(env, chatId, "🧠 Learn увімкнено.")
        return json({ ok: true })
    }

    if (textRaw === "/learn_off") {
        await setLearnMode(env, userId, false)
        await sendPlain(env, chatId, "🧠 Learn вимкнено.")
        return json({ ok: true })
    }

    // ----- Vision (photo or text follow-up) -----
    if (detectPhoto(msg) || textRaw.toLowerCase().includes("на фото")) {
        const done = await handleVision(env, ctx)
        if (done) return json({ ok: true })
    }

    // ----- Codex -----
    if (await getCodexMode(env, userId)) {
        const done = await handleCodex(env, ctx)
        if (done) return json({ ok: true })
    }

    // ----- Weather, date, time -----
    const lower = textRaw.toLowerCase()

    if (dateIntent(textRaw)) {
        await sendPlain(env, chatId, replyCurrentDate(env, lang))
        return json({ ok: true })
    }

    if (timeIntent(textRaw)) {
        await sendPlain(env, chatId, replyCurrentTime(env, lang))
        return json({ ok: true })
    }

    if (weatherIntent(textRaw)) {
        const match = textRaw.match(/в\s+(.+)/i)
        if (match && match[1]) {
            const place = match[1].trim()
            const { text } = await weatherSummaryByPlace(env, place, lang)
            await sendPlain(env, chatId, text)
        } else {
            const loc = await getUserLocation(env, userId)
            if (loc) {
                const { text } = await weatherSummaryByCoords(env, loc, lang)
                await sendPlain(env, chatId, text)
            } else {
                await sendPlain(env, chatId, "Надішли локацію, будь ласка.")
            }
        }
        return json({ ok: true })
    }

    // ----- GPS -----
    if (msg.location) {
        await setUserLocation(env, userId, msg.location)
        const { text } = await weatherSummaryByCoords(env, msg.location, lang)
        await sendPlain(env, chatId, text)
        return json({ ok: true })
    }

    // ----- Normal AI dialog -----
    const done = await handleAiDialog(env, ctx)
    if (done) return json({ ok: true })

    return json({ ok: true })
}
