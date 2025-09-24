const tgBase = (token) => `https://api.telegram.org/bot${token}`;
const tgFileBase = (token) => `https://api.telegram.org/file/bot${token}`;

export async function tgSendMessage(token, chatId, text, extra = {}) {
  const url = `${tgBase(token)}/sendMessage`;
  const body = { chat_id: chatId, text, parse_mode: "Markdown", ...extra };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

export async function tgSendChatAction(token, chatId, action = "typing") {
  const url = `${tgBase(token)}/sendChatAction`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action }),
  });
}

export async function tgGetFileUrl(token, fileId) {
  // 1) getFile → file_path
  const infoUrl = `${tgBase(token)}/getFile?file_id=${encodeURIComponent(
    fileId
  )}`;
  const info = await (await fetch(infoUrl)).json();
  const path = info?.result?.file_path;
  if (!path) return null;
  // 2) прямий URL
  return `${tgFileBase(token)}/${path}`;
}