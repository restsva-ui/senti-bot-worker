# RemindIt 0.9 Beta

**See it now. Remember it in time.**

RemindIt turns text, links, screenshots and photos shared from Android apps into actionable local reminders.

## Current beta capabilities

- Android share target for `text/plain` and `image/*`
- Offline Ukrainian, English and Russian OCR with bundled Tesseract models
- Local extraction of reminder meaning, date/time, category, phone number, amount and address
- Separate event time and alert lead time
- Smart alert defaults based on intent: appointment, travel, payment, call, reply, task, shopping or review
- Optional second early alert and two follow-ups when an item is not marked done
- Exact alarms with an explicit permission flow; no silent inexact fallback
- Automatic rescheduling after exact-alarm permission is granted and after device reboot, including missed repeat normalization without clock-time drift
- Built-in two-minute exact-alarm reliability test
- Notification actions for Done, snooze, tomorrow, saved original, phone call and route
- Snoozed alerts survive reopening the app and device reboot
- Duplicate reminder detection with update-or-save-another choice
- Local SQLite storage, completed history and repeat schedules
- Private local copies of shared images and saved source links
- Ukrainian and English UI
- No account, RemindIt server, ads or analytics

Example: `Запис до лікаря завтра о 15:30` becomes **“Не пропустити прийом до лікаря”** with the event set for tomorrow at 15:30. The appointment preset alerts one day and two hours beforehand, again at the event time, and—until marked Done—twice more every 30 minutes.

## Physical-device test flow

1. Install the newest `RemindIt-Beta-0.9-APK` artifact.
2. Allow notifications and exact reminders.
3. On HyperOS/MIUI, allow autostart and unrestricted background battery activity.
4. Open **Settings → Reliability check** and schedule the two-minute test.
5. Share text from Notes or a browser and confirm the detected event time and early alerts.
6. In airplane mode, share Ukrainian and English screenshots and verify OCR.
7. Create an event at least 15 minutes ahead, reboot the phone, unlock it without opening RemindIt, and wait for the alert.

Package: `com.remindit.app`

## Signing

GitHub Actions uses a cached beta signing identity so consecutive beta artifacts can update each other. This beta identity is not a production Google Play signing key. Production releases must use Play App Signing or a securely stored release keystore.
