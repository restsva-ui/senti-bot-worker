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
    private static final String CHANNEL_ID = "remindit_reminders_v3";

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
                    "Точні нагадування RemindIt",
                    "Exact RemindIt reminders"));
            channel.enableVibration(true);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
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
                .setShowWhen(true);

        manager.notify((int) (id ^ (id >>> 32)), builder.build());
    }
}
