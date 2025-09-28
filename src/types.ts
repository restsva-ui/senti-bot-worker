export type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
};

export type TgUser = { language_code?: string };
export type TgChat = { id: number };
export type TgMessage = { text?: string; chat: TgChat; from?: TgUser };
export type TgUpdate = { message?: TgMessage };