export const CFG = {
  API_BASE_URL: "https://api.telegram.org",
  BOT_TOKEN: TELEGRAM_BOT_TOKEN,              // з Env
  WEBHOOK_SECRET: WEBHOOK_SECRET || "",
  OWNER_ID: "784869835",
  DEFAULT_CHAT_ID: "784869835",
};
export const TG = {
  base: (t = CFG.BOT_TOKEN) => `${CFG.API_BASE_URL}/bot${t}`,
};