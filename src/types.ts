export type TgUser = { id?: number; language_code?: string; is_bot?: boolean };
export type TgChat = { id: number; type?: string };
export type TgMessage = {
  message_id?: number;
  text?: string;
  caption?: string;
  chat: TgChat;
  from?: TgUser;
  reply_to_message?: TgMessage;
};
export type TgCallbackQuery = {
  id: string;
  from?: TgUser;
  message?: TgMessage;
  data?: string;
};
export type TgUpdate = {
  update_id?: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallbackQuery;
};