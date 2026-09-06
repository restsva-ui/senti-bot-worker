# RemindIt MVP

**See it now. Remember it later.**

RemindIt is an Android-first reminder utility that turns shared text, links, screenshots and photos into reminders.

## MVP 0.1

- Share target from any Android app (`Share → RemindIt`)
- Text and URL intake
- Screenshot/photo intake
- On-device OCR with ML Kit
- Automatic date/time detection (Ukrainian + English basics)
- Automatic category suggestion
- Local SQLite storage
- Exact reminders when Android grants the permission
- Offline-first: no account, no server, no paid API
- Reminders survive phone reboot

## Test flow

1. Install the debug APK.
2. Allow notifications.
3. Optionally allow exact alarms/reminders when prompted from the home screen.
4. In Chrome, Gallery or another app choose **Share → RemindIt**.
5. Confirm the suggested title/date/category and save.
6. Wait for the local notification.

Package: `com.remindit.app`
