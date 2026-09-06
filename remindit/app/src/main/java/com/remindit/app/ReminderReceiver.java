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
    private static final String CHANNEL_ID = "remindit_exact_v4";

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
                    LanguageManager.pick(context, "Точні нагадування RemindIt", "Exact RemindIt reminders"),
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription(LanguageManager.pick(context,
                    "Нагадування, які мають з'являтися у вибраний час, навіть коли екран заблокований",
                    "Reminders that should appear at the selected time even while the screen is locked"));
            channel.enableVibration(true);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            manager.createNotificationChannel(channel);
        }

        Intent openIntent = new Intent(context, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
                context,
                (int) (id ^ (id >>> 32)),
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String content = !TextUtils.isEmpty(reminder.goal)
                ? reminder.goal
                : shortText(context, reminder.body);
        String expanded = !TextUtils.isEmpty(reminder.body)
                ? content + "\n\n" + reminder.body
                : content;

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, CHANNEL_ID)
                : new Notification.Builder(context);

        builder.setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(reminder.title)
                .setContentText(content)
                .setStyle(new Notification.BigTextStyle().bigText(expanded))
                .setContentIntent(contentIntent)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_ALARM)
                .setPriority(Notification.PRIORITY_MAX)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setWhen(System.currentTimeMillis())
                .setShowWhen(true);

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            builder.setDefaults(Notification.DEFAULT_ALL);
        }

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
