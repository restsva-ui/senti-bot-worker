# RemindIt 0.9 phone test

Record the device model, Android/HyperOS version, RemindIt version and local time zone with every result.

## Installation

- Install the newest `RemindIt-Beta-0.9-APK` artifact.
- The first 0.9 artifact may require uninstalling 0.8 because older workflow runs used temporary debug signing keys. Uninstalling removes local reminders and saved originals.
- Allow notifications and exact reminders.
- On HyperOS/MIUI, allow autostart and unrestricted background battery activity.

## Sharing and local understanding

- Share Ukrainian text: `Зателефонувати мамі завтра о 18:30`.
  - Expected: Call intent, tomorrow 18:30, 10-minute early alert.
- Share English text: `Pay the electricity bill tomorrow 19:15`.
  - Expected: Bills category, tomorrow 19:15, one-day and two-hour early alerts.
- Share a web page from Chrome.
  - Expected: the saved-original button opens the external browser.
- Share the same item again.
  - Expected: RemindIt offers to update the existing reminder or save another copy.

## Offline OCR

Enable airplane mode before the first OCR test after installation.

- Share the exact example screenshot: `Запис до лікаря завтра о 15:30`.
  - Expected: `Не пропустити прийом до лікаря`, tomorrow at 15:30, with the appointment preset visible as one day, two hours, event time, +30 minutes and +60 minutes. An early alert whose calculated time is already past is intentionally skipped.
- Ukrainian screenshot:
  - `Зустріч з лікарем`
  - `завтра о 18:30`
  - `вул. Хрещатик, 10`
  - Expected: appointment meaning, tomorrow 18:30, address detected, route action available.
- English screenshot:
  - `Pay the electricity bill`
  - `tomorrow 19:15`
  - `Amount: 850 UAH`
  - Expected: readable English OCR, payment meaning and amount detected.
- Repeat both tests after switching the UI between Ukrainian and English.
- Share a blurred or nearly empty image.
  - Expected: a safe manual-review fallback, not invented OCR text.

## Exact alerts and follow-ups

- In Settings, run the two-minute reliability test, lock the screen and close the app.
  - Expected: a high-priority test notification at the scheduled time and a successful result in Settings.
- Create a one-time event at least 35 minutes ahead with a 30-minute early alert and 10-minute follow-ups.
  - Expected: early alert, event-time alert, then up to two follow-ups until Done is selected.
- Select Done after the first notification.
  - Expected: every remaining alarm for that reminder is cancelled.
- Snooze an alert for 10 minutes.
  - Expected: a new exact alert after 10 minutes without changing the event time.
- After snoozing, open and close RemindIt; repeat once with a reboot before the 10 minutes expire.
  - Expected: the snoozed exact alert still fires in both cases.

## Reboot rescheduling

- Create an event at least 15 minutes ahead.
- Reboot the phone, unlock it, but do not open RemindIt.
- Expected: the next scheduled alert fires on time.
- For a daily repeat, power the phone off across one occurrence, then start it again without opening RemindIt.
  - Expected: the missed occurrence is skipped and the next one keeps the originally selected clock time.
- If it appears only after RemindIt is opened, record the battery/autostart settings as a failure condition.

## Privacy

- Open Settings → Privacy → Full policy in both languages.
- Confirm OCR works in airplane mode.
- Delete the original image from Gallery after sharing it; the private RemindIt copy should still open.
- Delete the reminder; its copied image and future alarms should no longer be available.
- Inspect the final beta APK manifest: it must not contain `android.permission.INTERNET` or `android.permission.ACCESS_NETWORK_STATE`.

## Result format

For every failed item attach:

1. test section and action;
2. expected and actual result;
3. screenshot or screen recording;
4. exact local time;
5. device model and Android/HyperOS version;
6. whether RemindIt was open, closed or removed from recent apps.
