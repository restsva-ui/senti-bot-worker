export function adminKeyboard() {
  return {
    keyboard: [
      [{ text: "Drive ✅" }, { text: "List 10 📄" }],
      [{ text: "Backup URL ⬆️" }, { text: "Checklist ➕" }],
      [{ text: "Меню" }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}// Мінімальна клавіатура для адмін-меню.
// Нічого "важкого" — лише підказки-кнопки текстом.

export function adminKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "Drive ✅" }, { text: "List 10 📄" }],
        [{ text: "Backup URL ⬆️" }, { text: "Checklist ➕" }],
        [{ text: "Меню" }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
      is_persistent: true
    }
  };
}