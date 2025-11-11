// src/routes/webhook.js

import { driveSaveFromUrl } from "../integrations/driveSaveFromUrl.js";
import { tgSendDocument } from "../integrations/tgSendDocument.js";
import { tgSendPhoto } from "../integrations/tgSendPhoto.js";
import { tgSendVideo } from "../integrations/tgSendVideo.js";
import { tgSendAudio } from "../integrations/tgSendAudio.js";
import { tgSendVoice } from "../integrations/tgSendVoice.js";
import { tgSendAnimation } from "../integrations/tgSendAnimation.js";
import { tgSendLocation } from "../integrations/tgSendLocation.js";
import { tgSendContact } from "../integrations/tgSendContact.js";
import { tgSendPoll } from "../integrations/tgSendPoll.js";
import { tgSendQuiz } from "../integrations/tgSendQuiz.js";
import { tgSendChatAction } from "../integrations/tgSendChatAction.js";
import { tgEditMessageText } from "../integrations/tgEditMessageText.js";
import { tgEditMessageCaption } from "../integrations/tgEditMessageCaption.js";
import { tgEditMessageMedia } from "../integrations/tgEditMessageMedia.js";
import { tgDeleteMessage } from "../integrations/tgDeleteMessage.js";
import { tgAnswerCallback } from "../integrations/tgAnswerCallback.js";
import { tgSetWebhook } from "../integrations/tgSetWebhook.js";
import { tgGetFileLink } from "../integrations/tgGetFileLink.js";
import { tgGetChat } from "../integrations/tgGetChat.js";
import { tgGetUserProfilePhotos } from "../integrations/tgGetUserProfilePhotos.js";
import { tgKickChatMember } from "../integrations/tgKickChatMember.js";
import { tgUnbanChatMember } from "../integrations/tgUnbanChatMember.js";
import { tgRestrictChatMember } from "../integrations/tgRestrictChatMember.js";
import { tgPromoteChatMember } from "../integrations/tgPromoteChatMember.js";
import { tgSetChatAdministratorCustomTitle } from "../integrations/tgSetChatAdministratorCustomTitle.js";
import { tgSetChatPhoto } from "../integrations/tgSetChatPhoto.js";
import { tgDeleteChatPhoto } from "../integrations/tgDeleteChatPhoto.js";
import { tgSetChatTitle } from "../integrations/tgSetChatTitle.js";
import { tgSetChatDescription } from "../integrations/tgSetChatDescription.js";
import { tgPinChatMessage } from "../integrations/tgPinChatMessage.js";
import { tgUnpinChatMessage } from "../integrations/tgUnpinChatMessage.js";
import { tgLeaveChat } from "../integrations/tgLeaveChat.js";
import { tgGetChatAdministrators } from "../integrations/tgGetChatAdministrators.js";
import { tgGetChatMembersCount } from "../integrations/tgGetChatMembersCount.js";
import { tgGetChatMember } from "../integrations/tgGetChatMember.js";
import { tgSetMyCommands } from "../integrations/tgSetMyCommands.js";
import { tgGetMyCommands } from "../integrations/tgGetMyCommands.js";

import { humanizeDate } from "../lib/humanizeDate.js";
import { detectIntent } from "../lib/detectIntent.js";
import { fetchSentiCore } from "../brain/sentiCore.js";
import { applyVisionPolicy } from "../flows/visionPolicy.js";
import { aiRespond } from "../flows/aiRespond.js";
import { aiImprove } from "../routes/aiImprove.js";
import { aiTrain } from "../routes/aiTrain.js";
import { brainApi } from "../routes/brainApi.js";
import { brainFallbacks } from "../routes/brainFallbacks.js";
import { brainPromote } from "../routes/brainPromote.js";
import { brainState } from "../routes/brainState.js";

import { SELF_TEST_LOCAL } from "./selfTestLocal.js";
import { SELF_TEST } from "./selfTest.js";
import { HEALTH } from "./health.js";
import { CI_DEPLOY } from "./ciDeploy.js";

import { handleImageDescribe } from "../flows/visionDescribe.js";
import { extractOcrFromImage } from "../lib/ocr.js";
import { detectFaces } from "../lib/faceDetect.js";
import { detectObjects } from "../lib/objectDetect.js";
import { detectBrands } from "../lib/brandDetect.js";
import { detectLandmarks } from "../lib/landmarkDetect.js";

const {
  BTN_DRIVE,
  BTN_DOC,
  BTN_PHOTO,
  BTN_VIDEO,
  BTN_AUDIO,
  BTN_VOICE,
  BTN_ANIMATION,
  BTN_LOCATION,
  BTN_CONTACT,
  BTN_POLL,
  BTN_QUIZ,
  BTN_CHAT_ACTION,
  BTN_EDIT_TEXT,
  BTN_EDIT_CAPTION,
  BTN_EDIT_MEDIA,
  BTN_DELETE,
  BTN_ANSWER_CALLBACK,
  BTN_SET_WEBHOOK,
  BTN_GET_FILE_LINK,
  BTN_GET_CHAT,
  BTN_GET_USER_PHOTOS,
  BTN_KICK,
  BTN_UNBAN,
  BTN_RESTRICT,
  BTN_PROMOTE,
  BTN_SET_ADMIN_TITLE,
  BTN_SET_CHAT_PHOTO,
  BTN_DELETE_CHAT_PHOTO,
  BTN_SET_CHAT_TITLE,
  BTN_SET_CHAT_DESC,
  BTN_PIN,
  BTN_UNPIN,
  BTN_LEAVE,
  BTN_GET_ADMINS,
  BTN_GET_MEMBERS_COUNT,
  BTN_GET_MEMBER,
  BTN_SET_COMMANDS,
  BTN_GET_COMMANDS,
} = await import("../ui/home.js");

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "senti1984";
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_AI_GATEWAY = process.env.CF_AI_GATEWAY || null;
const DEFAULT_MODEL =
  process.env.DEFAULT_MODEL ||
  "@cf/meta/llama-3.1-8b-instruct" ||
  "@cf/qwen/qwen-2.5-7b-instruct";

const ADMIN_ID = process.env.ADMIN_ID ? Number(process.env.ADMIN_ID) : null;

function isAdmin(userId) {
  if (!ADMIN_ID) return false;
  return Number(userId) === ADMIN_ID;
}

function makeInlineKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "📁 Drive", callback_data: BTN_DRIVE },
        { text: "📄 Doc", callback_data: BTN_DOC },
        { text: "🖼 Photo", callback_data: BTN_PHOTO },
      ],
      [
        { text: "🎬 Video", callback_data: BTN_VIDEO },
        { text: "🎵 Audio", callback_data: BTN_AUDIO },
        { text: "🎙 Voice", callback_data: BTN_VOICE },
      ],
      [
        { text: "🎞 Gif", callback_data: BTN_ANIMATION },
        { text: "📍 Location", callback_data: BTN_LOCATION },
        { text: "👤 Contact", callback_data: BTN_CONTACT },
      ],
      [
        { text: "📊 Poll", callback_data: BTN_POLL },
        { text: "❓ Quiz", callback_data: BTN_QUIZ },
        { text: "⌛ Typing", callback_data: BTN_CHAT_ACTION },
      ],
      [
        { text: "✏ Edit text", callback_data: BTN_EDIT_TEXT },
        { text: "🖼 Edit media", callback_data: BTN_EDIT_MEDIA },
        { text: "🗑 Delete", callback_data: BTN_DELETE },
      ],
      [
        { text: "🔔 Answer cb", callback_data: BTN_ANSWER_CALLBACK },
        { text: "🔗 Webhook", callback_data: BTN_SET_WEBHOOK },
        { text: "📥 File link", callback_data: BTN_GET_FILE_LINK },
      ],
      [
        { text: "ℹ Chat", callback_data: BTN_GET_CHAT },
        { text: "🖼 User photos", callback_data: BTN_GET_USER_PHOTOS },
        { text: "🦵 Kick", callback_data: BTN_KICK },
      ],
      [
        { text: "♻ Unban", callback_data: BTN_UNBAN },
        { text: "🔒 Restrict", callback_data: BTN_RESTRICT },
        { text: "⭐ Promote", callback_data: BTN_PROMOTE },
      ],
      [
        { text: "📛 Admin title", callback_data: BTN_SET_ADMIN_TITLE },
        { text: "🖼 Chat photo", callback_data: BTN_SET_CHAT_PHOTO },
        { text: "🚫 Del photo", callback_data: BTN_DELETE_CHAT_PHOTO },
      ],
      [
        { text: "✏ Chat title", callback_data: BTN_SET_CHAT_TITLE },
        { text: "📝 Chat desc", callback_data: BTN_SET_CHAT_DESC },
        { text: "📌 Pin", callback_data: BTN_PIN },
      ],
      [
        { text: "📍 Unpin", callback_data: BTN_UNPIN },
        { text: "🚪 Leave", callback_data: BTN_LEAVE },
        { text: "👑 Admins", callback_data: BTN_GET_ADMINS },
      ],
      [
        { text: "📊 Members", callback_data: BTN_GET_MEMBERS_COUNT },
        { text: "👤 Member", callback_data: BTN_GET_MEMBER },
        { text: "⚙ Commands", callback_data: BTN_SET_COMMANDS },
      ],
      [{ text: "📋 Get commands", callback_data: BTN_GET_COMMANDS }],
    ],
  };
}

export default {
  async fetch(request, env, ctx) {
    // Allow to run local/self tests
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return HEALTH.fetch(request, env, ctx);
    }
    if (url.pathname === "/self-test") {
      return SELF_TEST.fetch(request, env, ctx);
    }
    if (url.pathname === "/self-test-local") {
      return SELF_TEST_LOCAL.fetch(request, env, ctx);
    }
    if (url.pathname === "/ci-deploy") {
      return CI_DEPLOY.fetch(request, env, ctx);
    }

    if (request.method === "GET") {
      return new Response(
        JSON.stringify(
          {
            ok: true,
            service: "senti-bot-worker",
            version: "2.4 codex 0.1",
            tg: !!TG_BOT_TOKEN,
            webhook_secret: !!WEBHOOK_SECRET,
            cf_account: !!CF_ACCOUNT_ID,
            ai_gateway: !!CF_AI_GATEWAY,
            default_model: DEFAULT_MODEL,
            admin: !!ADMIN_ID,
          },
          null,
          2
        ),
        {
          headers: { "content-type": "application/json; charset=utf-8" },
        }
      );
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const signature = request.headers.get("X-Webhook-Secret");
    if (WEBHOOK_SECRET && signature !== WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    let update;
    try {
      update = await request.json();
    } catch (err) {
      return new Response("Bad JSON", { status: 400 });
    }

    try {
      const res = await handleUpdate(update, env, ctx);
      return res;
    } catch (err) {
      console.error("handleUpdate error", err);
      return new Response("Internal error", { status: 500 });
    }
  },
};
async function handleUpdate(update, env, ctx) {
  // Telegram update can be: message, edited_message, callback_query, ...
  const message = update.message || update.edited_message || null;
  const callbackQuery = update.callback_query || null;
  const inlineQuery = update.inline_query || null;
  const chatJoinRequest = update.chat_join_request || null;
  const myChatMember = update.my_chat_member || null;
  const chatMember = update.chat_member || null;

  // For debugging
  // console.log("UPDATE", JSON.stringify(update, null, 2));

  if (callbackQuery) {
    return handleCallback(callbackQuery, env, ctx);
  }

  if (inlineQuery) {
    // Inline mode not implemented yet
    return new Response("OK", { status: 200 });
  }

  if (chatJoinRequest) {
    // TODO: approve/deny
    return new Response("OK", { status: 200 });
  }

  if (myChatMember || chatMember) {
    // Bot was added/removed etc.
    return new Response("OK", { status: 200 });
  }

  if (!message) {
    return new Response("No message", { status: 200 });
  }

  // If it's a command
  if (message.text && message.text.startsWith("/")) {
    return handleCommand(message, env, ctx);
  }

  // If it's a media message
  if (
    message.photo ||
    message.video ||
    message.document ||
    message.audio ||
    message.voice ||
    message.animation
  ) {
    return handleMediaMessage(message, env, ctx);
  }

  // Otherwise treat as text
  return handleTextMessage(message, env, ctx);
}

async function handleCommand(message, env, ctx) {
  const chatId = message.chat.id;
  const userId = message.from?.id;
  const text = message.text || "";
  const [cmd, ...args] = text.split(" ");
  const argText = args.join(" ").trim();

  if (cmd === "/start") {
    const kb = makeInlineKeyboard();
    const welcome =
      "Привіт! Я Senti 2.4 codex 0.1 🤖\n" +
      "Я вмію приймати файли, фото, відео і одразу відправляти їх у твоє Drive або обробляти.\n" +
      "Можу також підключати AI для відповіді.\n" +
      "Спробуй кнопки нижче.";
    await tgSendChatAction(TG_BOT_TOKEN, chatId, "typing");
    await tgSendDocument(
      TG_BOT_TOKEN,
      chatId,
      null,
      welcome,
      null,
      null,
      kb
    );
    return new Response("OK", { status: 200 });
  }

  if (cmd === "/help") {
    const help =
      "Команди:\n" +
      "/start - показати меню\n" +
      "/help - ця довідка\n" +
      "/ai <текст> - запит до AI\n" +
      "/ocr - витягнути текст з останнього фото\n" +
      "/vision - описати останнє фото\n" +
      "/admin - адмін-меню (для власника)\n" +
      "/self-test - внутрішній тест\n" +
      "/health - стан воркера";
    await tgSendChatAction(TG_BOT_TOKEN, chatId, "typing");
    await tgSendDocument(TG_BOT_TOKEN, chatId, null, help);
    return new Response("OK", { status: 200 });
  }

  if (cmd === "/ai") {
    if (!argText) {
      await tgSendDocument(
        TG_BOT_TOKEN,
        chatId,
        null,
        "Дай текст після /ai, напр. /ai поясни як працює Senti"
      );
      return new Response("OK", { status: 200 });
    }
    await tgSendChatAction(TG_BOT_TOKEN, chatId, "typing");
    const aiRes = await aiRespond(argText, {
      env,
      ctx,
      userId,
      chatId,
    });
    await tgSendDocument(TG_BOT_TOKEN, chatId, null, aiRes || "Не вийшло 🤔");
    return new Response("OK", { status: 200 });
  }

  if (cmd === "/vision") {
    await tgSendDocument(
      TG_BOT_TOKEN,
      chatId,
      null,
      "Надішли фото, я спробую його описати."
    );
    return new Response("OK", { status: 200 });
  }

  if (cmd === "/ocr") {
    await tgSendDocument(
      TG_BOT_TOKEN,
      chatId,
      null,
      "Надішли фото, я витягну з нього текст."
    );
    return new Response("OK", { status: 200 });
  }

  if (cmd === "/admin") {
    if (!isAdmin(userId)) {
      await tgSendDocument(
        TG_BOT_TOKEN,
        chatId,
        null,
        "Це адмін-меню. Доступ заборонено."
      );
      return new Response("OK", { status: 200 });
    }
    const adminText =
      "Адмін-меню:\n" +
      "- /setwebhook <url>\n" +
      "- /getchat\n" +
      "- /getcommands\n" +
      "- /setcommands\n" +
      "- /self-test\n" +
      "- /health";
    await tgSendDocument(TG_BOT_TOKEN, chatId, null, adminText);
    return new Response("OK", { status: 200 });
  }

  if (cmd === "/setwebhook") {
    if (!isAdmin(userId)) {
      await tgSendDocument(
        TG_BOT_TOKEN,
        chatId,
        null,
        "Тільки адмін може ставити вебхук."
      );
      return new Response("OK", { status: 200 });
    }
    if (!argText) {
      await tgSendDocument(
        TG_BOT_TOKEN,
        chatId,
        null,
        "Вкажи URL, напр. /setwebhook https://example.com/webhook"
      );
      return new Response("OK", { status: 200 });
    }
    const r = await tgSetWebhook(TG_BOT_TOKEN, argText);
    await tgSendDocument(
      TG_BOT_TOKEN,
      chatId,
      null,
      "Webhook set: " + JSON.stringify(r)
    );
    return new Response("OK", { status: 200 });
  }

  if (cmd === "/self-test") {
    return SELF_TEST.fetch(
      new Request("http://local/self-test"),
      env,
      ctx
    );
  }

  if (cmd === "/health") {
    return HEALTH.fetch(new Request("http://local/health"), env, ctx);
  }

  // Unknown command
  await tgSendDocument(TG_BOT_TOKEN, chatId, null, "Невідома команда.");
  return new Response("OK", { status: 200 });
}
async function handleMediaMessage(message, env, ctx) {
  const chatId = message.chat.id;
  const userId = message.from?.id;
  const caption = message.caption || "";
  const hasPhoto = !!message.photo;
  const hasVideo = !!message.video;
  const hasDoc = !!message.document;
  const hasAudio = !!message.audio;
  const hasVoice = !!message.voice;
  const hasAnimation = !!message.animation;

  // If user added a caption that starts with /ai - treat as AI request with media
  if (caption && caption.startsWith("/ai")) {
    const prompt = caption.replace("/ai", "").trim() || "Опиши файл/фото.";
    await tgSendChatAction(TG_BOT_TOKEN, chatId, "typing");
    let fileUrl = null;

    if (hasPhoto) {
      const photo = message.photo[message.photo.length - 1];
      fileUrl = await tgGetFileLink(TG_BOT_TOKEN, photo.file_id);
    } else if (hasVideo) {
      fileUrl = await tgGetFileLink(TG_BOT_TOKEN, message.video.file_id);
    } else if (hasDoc) {
      fileUrl = await tgGetFileLink(TG_BOT_TOKEN, message.document.file_id);
    }

    const aiRes = await aiRespond(prompt, {
      env,
      ctx,
      userId,
      chatId,
      mediaUrl: fileUrl,
    });
    await tgSendDocument(TG_BOT_TOKEN, chatId, null, aiRes || "Не вийшло 🤔");
    return new Response("OK", { status: 200 });
  }

  // If it's photo - we can apply vision / OCR
  if (hasPhoto) {
    const photo = message.photo[message.photo.length - 1]; // biggest size
    const fileUrl = await tgGetFileLink(TG_BOT_TOKEN, photo.file_id);

    // Apply vision policy
    const visionResult = await applyVisionPolicy(fileUrl, { env, ctx });
    // Try OCR
    const ocrText = await extractOcrFromImage(fileUrl, { env, ctx }).catch(
      () => null
    );
    // Try object/faces/brands/landmarks
    const faces = await detectFaces(fileUrl, { env, ctx }).catch(() => null);
    const objects = await detectObjects(fileUrl, { env, ctx }).catch(
      () => null
    );
    const brands = await detectBrands(fileUrl, { env, ctx }).catch(() => null);
    const landmarks = await detectLandmarks(fileUrl, { env, ctx }).catch(
      () => null
    );

    let reply =
      "Фото отримано ✅\n" +
      (visionResult?.description
        ? "Опис: " + visionResult.description + "\n"
        : "") +
      (ocrText ? "OCR: " + ocrText.slice(0, 500) + "\n" : "") +
      (faces ? "Обличчя: " + JSON.stringify(faces) + "\n" : "") +
      (objects ? "Обʼєкти: " + JSON.stringify(objects) + "\n" : "") +
      (brands ? "Бренди: " + JSON.stringify(brands) + "\n" : "") +
      (landmarks ? "Місця: " + JSON.stringify(landmarks) + "\n" : "");

    await tgSendDocument(TG_BOT_TOKEN, chatId, null, reply);
    return new Response("OK", { status: 200 });
  }

  // If it's document - save to drive if configured
  if (hasDoc) {
    const fileUrl = await tgGetFileLink(TG_BOT_TOKEN, message.document.file_id);
    if (env.DRIVE_ACCESS_TOKEN) {
      const saved = await driveSaveFromUrl(
        env.DRIVE_ACCESS_TOKEN,
        fileUrl,
        message.document.file_name
      ).catch(() => null);
      await tgSendDocument(
        TG_BOT_TOKEN,
        chatId,
        null,
        saved
          ? "Документ збережено в Drive ✅"
          : "Не вдалося зберегти в Drive, але файл отримано."
      );
    } else {
      await tgSendDocument(
        TG_BOT_TOKEN,
        chatId,
        null,
        "Документ отримано ✅ (Drive не налаштовано)"
      );
    }
    return new Response("OK", { status: 200 });
  }

  if (hasVideo) {
    const fileUrl = await tgGetFileLink(TG_BOT_TOKEN, message.video.file_id);
    await tgSendDocument(
      TG_BOT_TOKEN,
      chatId,
      null,
      "Відео отримано ✅\n" + (fileUrl ? "Посилання: " + fileUrl : "")
    );
    return new Response("OK", { status: 200 });
  }

  if (hasAudio) {
    const fileUrl = await tgGetFileLink(TG_BOT_TOKEN, message.audio.file_id);
    await tgSendDocument(
      TG_BOT_TOKEN,
      chatId,
      null,
      "Аудіо отримано ✅\n" + (fileUrl ? "Посилання: " + fileUrl : "")
    );
    return new Response("OK", { status: 200 });
  }

  if (hasVoice) {
    const fileUrl = await tgGetFileLink(TG_BOT_TOKEN, message.voice.file_id);
    await tgSendDocument(
      TG_BOT_TOKEN,
      chatId,
      null,
      "Голосове отримано ✅\n" + (fileUrl ? "Посилання: " + fileUrl : "")
    );
    return new Response("OK", { status: 200 });
  }

  if (hasAnimation) {
    const fileUrl = await tgGetFileLink(
      TG_BOT_TOKEN,
      message.animation.file_id
    );
    await tgSendDocument(
      TG_BOT_TOKEN,
      chatId,
      null,
      "GIF/анімація отримана ✅\n" + (fileUrl ? "Посилання: " + fileUrl : "")
    );
    return new Response("OK", { status: 200 });
  }

  await tgSendDocument(
    TG_BOT_TOKEN,
    chatId,
    null,
    "Файл отримано, але я ще не вмію з ним працювати 💾"
  );
  return new Response("OK", { status: 200 });
}
async function handleTextMessage(message, env, ctx) {
  const chatId = message.chat.id;
  const userId = message.from?.id;
  const text = message.text || message.caption || "";

  if (!text) {
    await tgSendDocument(TG_BOT_TOKEN, chatId, null, "Порожнє повідомлення.");
    return new Response("OK", { status: 200 });
  }

  // Detect intent
  const intent = await detectIntent(text, { env, ctx }).catch(() => null);

  // If intent is AI
  if (intent === "ai") {
    await tgSendChatAction(TG_BOT_TOKEN, chatId, "typing");
    const aiRes = await aiRespond(text, {
      env,
      ctx,
      userId,
      chatId,
    });
    await tgSendDocument(TG_BOT_TOKEN, chatId, null, aiRes || "Не вийшло 🤔");
    return new Response("OK", { status: 200 });
  }

  // If intent is vision
  if (intent === "vision") {
    await tgSendDocument(
      TG_BOT_TOKEN,
      chatId,
      null,
      "Надішли фото, я спробую його описати (vision)."
    );
    return new Response("OK", { status: 200 });
  }

  // If intent is drive
  if (intent === "drive") {
    await tgSendDocument(
      TG_BOT_TOKEN,
      chatId,
      null,
      "Надішли файл, я спробую зберегти його у Drive."
    );
    return new Response("OK", { status: 200 });
  }

  // Fallback: send to AI
  await tgSendChatAction(TG_BOT_TOKEN, chatId, "typing");
  const aiRes = await aiRespond(text, {
    env,
    ctx,
    userId,
    chatId,
  });
  await tgSendDocument(TG_BOT_TOKEN, chatId, null, aiRes || "Не зміг відповісти 🤔");
  return new Response("OK", { status: 200 });
}

async function handleCallback(callbackQuery, env, ctx) {
  const data = callbackQuery.data;
  const message = callbackQuery.message;
  const chatId = message.chat.id;
  const messageId = message.message_id;

  switch (data) {
    case BTN_DRIVE: {
      await tgEditMessageText(
        TG_BOT_TOKEN,
        chatId,
        messageId,
        "Надішли файл, я збережу його у Drive."
      );
      break;
    }
    case BTN_DOC: {
      await tgEditMessageText(
        TG_BOT_TOKEN,
        chatId,
        messageId,
        "Надішли документ (doc/pdf)."
      );
      break;
    }
    case BTN_PHOTO: {
      await tgEditMessageText(
        TG_BOT_TOKEN,
        chatId,
        messageId,
        "Надішли фото 📷"
      );
      break;
    }
    case BTN_VIDEO: {
      await tgEditMessageText(
        TG_BOT_TOKEN,
        chatId,
        messageId,
        "Надішли відео 🎬"
      );
      break;
    }
    case BTN_AUDIO: {
      await tgEditMessageText(
        TG_BOT_TOKEN,
        chatId,
        messageId,
        "Надішли аудіо 🎵"
      );
      break;
    }
    case BTN_VOICE: {
      await tgEditMessageText(
        TG_BOT_TOKEN,
        chatId,
        messageId,
        "Надішли голосове 🎙"
      );
      break;
    }
    case BTN_ANIMATION: {
      await tgEditMessageText(
        TG_BOT_TOKEN,
        chatId,
        messageId,
        "Надішли gif/анімацію 🎞"
      );
      break;
    }
    case BTN_LOCATION: {
      await tgEditMessageText(
        TG_BOT_TOKEN,
        chatId,
        messageId,
        "Надішли локацію 📍"
      );
      break;
    }
    case BTN_CONTACT: {
      await tgEditMessageText(
        TG_BOT_TOKEN,
        chatId,
        messageId,
        "Надішли контакт 👤"
      );
      break;
    }
    case BTN_POLL: {
      const r = await tgSendPoll(
        TG_BOT_TOKEN,
        chatId,
        "Опитування від Senti",
        ["Варіант 1", "Варіант 2"],
        false
      );
      await tgAnswerCallback(TG_BOT_TOKEN, callbackQuery.id, "Опитування створено");
      break;
    }
    case BTN_QUIZ: {
      const r = await tgSendQuiz(
        TG_BOT_TOKEN,
        chatId,
        "Квіз від Senti",
        ["1", "2", "3"],
        1
      );
      await tgAnswerCallback(TG_BOT_TOKEN, callbackQuery.id, "Квіз створено");
      break;
    }
    case BTN_CHAT_ACTION: {
      await tgSendChatAction(TG_BOT_TOKEN, chatId, "typing");
      await tgAnswerCallback(TG_BOT_TOKEN, callbackQuery.id, "Typing...");
      break;
    }
    case BTN_EDIT_TEXT: {
      await tgEditMessageText(
        TG_BOT_TOKEN,
        chatId,
        messageId,
        "Текст змінено ✅"
      );
      await tgAnswerCallback(TG_BOT_TOKE
await tgAnswerCallback(TG_BOT_TOKEN, callbackQuery.id, "OK");
      break;
    }
    case BTN_EDIT_CAPTION: {
      await tgEditMessageCaption(
        TG_BOT_TOKEN,
        chatId,
        messageId,
        "Підпис змінено ✅"
      );
      await tgAnswerCallback(TG_BOT_TOKEN, callbackQuery.id, "OK");
      break;
    }
    case BTN_EDIT_MEDIA: {
      // Not implemented, just answer
      await tgAnswerCallback(
        TG_BOT_TOKEN,
        callbackQuery.id,
        "Edit media поки не реалізовано"
      );
      break;
    }
    case BTN_DELETE: {
      await tgDeleteMessage(TG_BOT_TOKEN, chatId, messageId);
      await tgAnswerCallback(TG_BOT_TOKEN, callbackQuery.id, "Видалено");
      break;
    }
    case BTN_ANSWER_CALLBACK: {
      await tgAnswerCallback(TG_BOT_TOKEN, callbackQuery.id, "Це callback-відповідь");
      break;
    }
    case BTN_SET_WEBHOOK: {
      await tgAnswerCallback(
        TG_BOT_TOKEN,
        callbackQuery.id,
        "Використай /setwebhook <url>"
      );
      break;
    }
    case BTN_GET_FILE_LINK: {
      await tgAnswerCallback(
        TG_BOT_TOKEN,
        callbackQuery.id,
        "Надішли файл, я дам лінк."
      );
      break;
    }
    case BTN_GET_CHAT: {
      const chatInfo = await tgGetChat(TG_BOT_TOKEN, chatId);
      await tgEditMessageText(
        TG_BOT_TOKEN,
        chatId,
        messageId,
        "Chat info:\n" + JSON.stringify(chatInfo, null, 2)
      );
      break;
    }
    case BTN_GET_USER_PHOTOS: {
      const userId = callbackQuery.from.id;
      const photos = await tgGetUserProfilePhotos(TG_BOT_TOKEN, userId);
      await tgEditMessageText(
        TG_BOT_TOKEN,
        chatId,
        messageId,
        "Photos:\n" + JSON.stringify(photos, null, 2)
      );
      break;
    }
    case BTN_KICK: {
      const userId = callbackQuery.from.id;
      await tgKickChatMember(TG_BOT_TOKEN, chatId, userId);
      await tgAnswerCallback(TG_BOT_TOKEN, callbackQuery.id, "Користувача кікнуто");
      break;
    }
    case BTN_UNBAN: {
      const userId = callbackQuery.from.id;
      await tgUnbanChatMember(TG_BOT_TOKEN, chatId, userId);
      await tgAnswerCallback(TG_BOT_TOKEN, callbackQuery.id, "Розбанено");
      break;
    }
    case BTN_RESTRICT: {
      const userId = callbackQuery.from.id;
      await tgRestrictChatMember(TG_BOT_TOKEN, chatId, userId, {
        can_send_messages: false,
      });
      await tgAnswerCallback(TG_BOT_TOKEN, callbackQuery.id, "Обмежено");
      break;
    }
    case BTN_PROMOTE: {
      const userId = callbackQuery.from.id;
      await tgPromoteChatMember(TG_BOT_TOKEN, chatId, userId, {
        can_change_info: true,
        can_delete_messages: true,
        can_invite_users: true,
      });
      await tgAnswerCallback(TG_BOT_TOKEN, callbackQuery.id, "Підвищено");
      break;
    }
    case BTN_SET_ADMIN_TITLE: {
      const userId = callbackQuery.from.id;
      await tgSetChatAdministratorCustomTitle(
        TG_BOT_TOKEN,
        chatId,
        userId,
        "Senti admin"
      );
      await tgAnswerCallback(TG_BOT_TOKEN, callbackQuery.id, "Заголовок поставлено");
      break;
    }
    case BTN_SET_CHAT_PHOTO: {
      await tgAnswerCallback(
        TG_BOT_TOKEN,
        callbackQuery.id,
        "Надішли фото у чат, я поставлю."
      );
      break;
    }
    case BTN_DELETE_CHAT_PHOTO: {
      await tgDeleteChatPhoto(TG_BOT_TOKEN, chatId);
      await tgAnswerCallback(TG_BOT_TOKEN, callbackQuery.id, "Фото чату видалено");
      break;
    }
    case BTN_SET_CHAT_TITLE: {
      await tgSetChatTitle(TG_BOT_TOKEN, chatId, "Новий чат від Senti");
      await tgAnswerCallback(TG_BOT_TOKEN, callbackQuery.id, "Тайтл змінено");
      break;
    }
    case BTN_SET_CHAT_DESC: {
      await tgSetChatDescription(TG_BOT_TOKEN, chatId, "Опис чату від Senti");
      await tgAnswerCallback(TG_BOT_TOKEN, callbackQuery.id, "Опис змінено");
      break;
    }
    case BTN_PIN: {
      await tgPinChatMessage(TG_BOT_TOKEN, chatId, messageId);
      await tgAnswerCallback(TG_BOT_TOKEN, callbackQuery.id, "Закріплено");
      break;
    }
    case BTN_UNPIN: {
      await tgUnpinChatMessage(TG_BOT_TOKEN, chatId, messageId);
      await tgAnswerCallback(TG_BOT_TOKEN, callbackQuery.id, "Відкріплено");
      break;
    }
    case BTN_LEAVE: {
      await tgLeaveChat(TG_BOT_TOKEN, chatId);
      break;
    }
    case BTN_GET_ADMINS: {
      const admins = await tgGetChatAdministrators(TG_BOT_TOKEN, chatId);
      await tgEditMessageText(
        TG_BOT_TOKEN,
        chatId,
        messageId,
        "Admins:\n" + JSON.stringify(admins, null, 2)
      );
      break;
    }
    case BTN_GET_MEMBERS_COUNT: {
      const count = await tgGetChatMembersCount(TG_BOT_TOKEN, chatId);
      await tgEditMessageText(
        TG_BOT_TOKEN,
        chatId,
        messageId,
        "Members count: " + count
      );
      break;
    }
    case BTN_GET_MEMBER: {
      const userId = callbackQuery.from.id;
      const member = await tgGetChatMember(TG_BOT_TOKEN, chatId, userId);
      await tgEditMessageText(
        TG_BOT_TOKEN,
        chatId,
        messageId,
        "Member:\n" + JSON.stringify(member, null, 2)
      );
      break;
    }
    case BTN_SET_COMMANDS: {
      const r = await tgSetMyCommands(TG_BOT_TOKEN, [
        { command: "start", description: "Старт" },
        { command: "help", description: "Допомога" },
        { command: "ai", description: "AI-відповідь" },
        { command: "vision", description: "Опис фото" },
        { command: "ocr", description: "Текст з фото" },
      ]);
      await tgAnswerCallback(
        TG_BOT_TOKEN,
        callbackQuery.id,
        "Команди встановлено"
      );
      break;
    }
    case BTN_GET_COMMANDS: {
      const r = await tgGetMyCommands(TG_BOT_TOKEN);
      await tgEditMessageText(
        TG_BOT_TOKEN,
        chatId,
        messageId,
        "Commands:\n" + JSON.stringify(r, null, 2)
      );
      break;
    }
    default: {
      await tgAnswerCallback(TG_BOT_TOKEN, callbackQuery.id, "Невідомо");
      break;
    }
  }

  return new Response("OK", { status: 200 });
}