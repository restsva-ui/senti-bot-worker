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
    private static final String CHANNEL_ID = "remindit_reminders_v4";

    @Override
    public void onReceive(Context context, Intent intent) {
        long id = intent.getLongExtra("reminder_id", -1L);
        if (id < 0) return;

        Reminder reminder = new ReminderDb(context).get(id);
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
                    "Точні нагадування з оригінальним звуком RemindIt",
                    "Exact reminders with the original RemindIt sound"));
            channel.enableVibration(true);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            channel.setSound(null, null);
            manager.createNotificationChannel(channel);
        }

        Intent openIntent = new Intent(context, MainActivity.class);
        PendingIntent contentIntent = PendingIntent.getActivity(
                context,
                (int) (id ^ (id >>> 32)),
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String essence = !TextUtils.isEmpty(reminder.goal) ? reminder.goal : reminder.title;
        if (TextUtils.isEmpty(essence)) {
            essence = LanguageManager.pick(context, "Нагадування", "Reminder");
        }

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

        PendingIntent originalIntent = OriginalActions.pending(context, reminder, 17000);
        if (originalIntent != null) {
            builder.addAction(new Notification.Action.Builder(
                    R.drawable.ic_notification,
                    OriginalActions.actionLabel(context, reminder),
                    originalIntent
            ).build());
        }

        manager.notify((int) (id ^ (id >>> 32)), builder.build());

        // Keep the receiver alive for the short custom chime so it also plays
        // reliably when the phone is locked / dozing.
        ReminderSound.playBlocking();
    }
}
