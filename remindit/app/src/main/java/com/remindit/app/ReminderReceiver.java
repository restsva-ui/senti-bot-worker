package com.remindit.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.text.TextUtils;

public class ReminderReceiver extends BroadcastReceiver {
    private static final String CHANNEL_ID = "remindit_reminders_v5";

    @Override
    public void onReceive(Context context, Intent intent) {
        long id = intent.getLongExtra("reminder_id", -1L);
        if (id < 0) return;

        ReminderDb db = new ReminderDb(context);
        Reminder reminder = db.get(id);
        if (reminder == null || reminder.done) return;

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    LanguageManager.pick(context, "Нагадування RemindIt", "RemindIt reminders"),
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription(LanguageManager.pick(context,
                    "Точні нагадування з оригінальним звуком і швидкими діями RemindIt",
                    "Exact reminders with RemindIt sound and quick actions"));
            channel.enableVibration(true);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            channel.setSound(null, null);
            manager.createNotificationChannel(channel);
        }

        PendingIntent contentIntent = activityPending(context, id);
        String essence = !TextUtils.isEmpty(reminder.goal) ? reminder.goal : reminder.title;
        if (TextUtils.isEmpty(essence)) essence = LanguageManager.pick(context, "Нагадування", "Reminder");

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, CHANNEL_ID)
                : new Notification.Builder(context);

        builder.setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("RemindIt")
                .setContentText(essence)
                .setStyle(new Notification.BigTextStyle().bigText(essence))
                .setContentIntent(contentIntent)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_REMINDER)
                .setPriority(Notification.PRIORITY_HIGH)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setWhen(System.currentTimeMillis())
                .setShowWhen(true)
                .setOnlyAlertOnce(true);

        builder.addAction(action(context, id, ReminderActionReceiver.ACTION_DONE,
                LanguageManager.pick(context, "✓ Виконано", "✓ Done"), 2001));

        if (!reminder.isRepeating()) {
            builder.addAction(action(context, id, ReminderActionReceiver.ACTION_SNOOZE_10,
                    LanguageManager.pick(context, "+10 хв", "+10 min"), 2002));
            builder.addAction(action(context, id, ReminderActionReceiver.ACTION_SNOOZE_60,
                    LanguageManager.pick(context, "+1 год", "+1 hour"), 2003));
            builder.addAction(action(context, id, ReminderActionReceiver.ACTION_TOMORROW,
                    LanguageManager.pick(context, "Завтра", "Tomorrow"), 2004));
        }

        PendingIntent originalIntent = OriginalActions.pending(context, reminder, 17000);
        if (originalIntent != null) {
            builder.addAction(new Notification.Action.Builder(
                    R.drawable.ic_notification,
                    OriginalActions.actionLabel(context, reminder),
                    originalIntent
            ).build());
        }

        manager.notify(ReminderActionReceiver.notificationId(id), builder.build());

        if (reminder.isRepeating()) {
            long next = ReminderScheduler.nextOccurrence(reminder, Math.max(System.currentTimeMillis(), reminder.remindAt));
            if (next > 0) {
                reminder.remindAt = next;
                db.update(reminder);
                ReminderScheduler.schedule(context, reminder);
            }
        }

        ReminderSound.playBlocking();
    }

    private PendingIntent activityPending(Context context, long id) {
        Intent openIntent = new Intent(context, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
                context,
                ReminderActionReceiver.notificationId(id),
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private Notification.Action action(Context context, long id, String action, String label, int salt) {
        Intent intent = new Intent(context, ReminderActionReceiver.class);
        intent.setAction(action);
        intent.putExtra("reminder_id", id);
        PendingIntent pending = PendingIntent.getBroadcast(
                context,
                ReminderActionReceiver.notificationId(id) + salt,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return new Notification.Action.Builder(R.drawable.ic_notification, label, pending).build();
    }
}
