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
    private static final String CHANNEL_ID = "remindit_reminders";

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
                    "Точні нагадування, створені в RemindIt",
                    "Exact reminders created in RemindIt"));
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);
        }

        Intent openIntent = new Intent(context, MainActivity.class);
        PendingIntent contentIntent = PendingIntent.getActivity(
                context,
                (int) (id ^ (id >>> 32)),
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String content = !TextUtils.isEmpty(reminder.goal)
                ? reminder.goal
                : shortText(context, reminder.body);
        String expanded;
        if (!TextUtils.isEmpty(reminder.goal) && !TextUtils.isEmpty(reminder.body)) {
            expanded = LanguageManager.pick(context, "Мета: ", "Goal: ") + reminder.goal
                    + "\n\n" + reminder.body;
        } else {
            expanded = content;
        }

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, CHANNEL_ID)
                : new Notification.Builder(context);

        builder.setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(reminder.title)
                .setContentText(content)
                .setStyle(new Notification.BigTextStyle().bigText(expanded))
                .setContentIntent(contentIntent)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_REMINDER)
                .setPriority(Notification.PRIORITY_HIGH)
                .setWhen(System.currentTimeMillis())
                .setShowWhen(true);

        manager.notify((int) (id ^ (id >>> 32)), builder.build());
    }

    private String shortText(Context context, String text) {
        if (text == null || text.trim().isEmpty()) {
            return LanguageManager.pick(context,
                    "Ти попросив RemindIt нагадати про це.",
                    "You asked RemindIt to remind you.");
        }
        String clean = text.replace('\n', ' ').trim();
        return clean.length() > 90 ? clean.substring(0, 87) + "…" : clean;
    }
}
