import { CFG, TG } from "../config";

export async function sendMessage(chat_id: string|number, text: string, extra: any = {}) {
  const r = await fetch(`${TG.base()}/sendMessage`, {
    method: "POST",
    headers: {"content-type":"application/json"},
    body: JSON.stringify({ chat_id, text, ...extra })
  });
  if (!r.ok) throw new Error(`sendMessage failed: ${r.status}`);
  return r.json();
}

export async function setMyCommands(cmds: {command:string; description:string}[]) {
  return fetch(`${TG.base()}/setMyCommands`, {
    method: "POST",
    headers: {"content-type":"application/json"},
    body: JSON.stringify({ commands: cmds })
  });
}