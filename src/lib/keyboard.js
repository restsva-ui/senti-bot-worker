// src/lib/keyboard.js

/**
 * Телеграм Reply Keyboard для адмін-меню.
 * Підписи повинні збігатися з тим, що очікує routes/admin.js.
 */
export function adminKeyboard() {
  return {
    keyboard: [
      [{ text: "Drive ✅" }, { text: "List 10 🧾" }],
      [{ text: "Backup URL ⬆️" }, { text: "Checklist ➕" }],
      [{ text: "Меню" }]
    ],
    resize_keyboard: true,
    is_persistent: true,
    one_time_keyboard: false
  };
}