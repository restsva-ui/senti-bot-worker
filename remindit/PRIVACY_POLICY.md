# RemindIt Privacy Policy (Beta 0.9)

_Last updated: 8 September 2026_

RemindIt is a local-first reminder application.

## Data processed by the app

RemindIt processes reminder text, links, screenshots and photos that the user explicitly adds or shares with the app. It can also store event time, alert timing, category, completion status and a locally generated reminder meaning.

## Local storage and processing

Reminder data and saved image originals are stored in RemindIt's private application storage on the user's Android device. RemindIt does not operate a user account or synchronization server and the application code does not upload reminder content to a RemindIt service.

Ukrainian, English and Russian OCR run on the device using language models bundled with the APK. Runtime OCR does not require uploading images to a remote OCR service.

## Internet access

The RemindIt 0.9 application is designed not to request Android's `INTERNET` permission. When a user opens a saved web link, Android hands the link to the user's browser or another compatible application. Route and call actions are likewise handed to external compatible applications.

## Notifications and exact alarms

RemindIt uses Android notifications and exact alarms to deliver early alerts, event-time alerts and optional follow-ups. It also receives the device boot broadcast to restore future schedules. Notification visibility and lock-screen presentation are controlled by Android and device settings.

## Saved originals

When a screenshot or photo is shared with RemindIt, the app creates a private local copy so the user can return to the original. Deleting that reminder also deletes its associated local image copy. For links, RemindIt stores the URL with the reminder.

## Device backups

Android may include application data in device backup depending on operating-system and backup settings. This behavior is controlled by Android/device settings, not by a RemindIt server.

## Analytics and advertising

The current RemindIt beta does not include advertising, analytics or third-party tracking SDKs.

## Permissions

RemindIt may request notification permission and exact-alarm capability. It also declares reboot reception so future reminders can be rescheduled after the phone starts. These capabilities can be changed in Android Settings.

## Data deletion

Users can delete individual reminders inside RemindIt. Removing the app from the device removes its private application data according to Android's app-uninstall behavior, subject to device backup settings.

## Changes

This policy will be updated before features such as optional cloud backup, synchronization, analytics, advertising or monetization are introduced. Such features must also be reflected in the Google Play Data safety declaration.

## Contact

Privacy questions can be submitted through the repository's GitHub Issues page:
https://github.com/restsva-ui/senti-bot-worker/issues
