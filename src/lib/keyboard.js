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
}