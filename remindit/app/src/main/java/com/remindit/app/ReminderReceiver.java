package com.remindit.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public class ReminderReceiver extends BroadcastReceiver {
    private static final String CHANNEL_ID = "remindit_reminders";

    @Override
    public void onReceive(Context context, Intent intent) {
        long id = intent.getLongExtra("reminder_id", -1L);
        if (id < 0) return;

        Reminder reminder = new ReminderDb(context).get(id);
        if (reminder == null || reminder.done) return;

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    LanguageManager.text(context, "RemindIt reminders", "Нагадування RemindIt"),
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription(LanguageManager.text(
                    context,
                    "Reminders created in RemindIt",
                    "Нагадування, створені в RemindIt"
            ));
            manager.createNotificationChannel(channel);
        }

        Intent openIntent = new Intent(context, MainActivity.class);
        PendingIntent contentIntent = PendingIntent.getActivity(
                context,
                (int) (id ^ (id >>> 32)),
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, CHANNEL_ID)
                : new Notification.Builder(context);

        String body = reminder.body;
        String fallback = LanguageManager.text(
                context,
                "You asked RemindIt to remind you.",
                "Ти просив RemindIt нагадати про це."
        );
        String displayBody = body == null || body.trim().isEmpty() ? fallback : body;

        builder.setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(reminder.title)
                .setContentText(shortText(displayBody))
                .setStyle(new Notification.BigTextStyle().bigText(displayBody))
                .setContentIntent(contentIntent)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_REMINDER)
                .setPriority(Notification.PRIORITY_HIGH);

        manager.notify((int) (id ^ (id >>> 32)), builder.build());
    }

    private String shortText(String text) {
        String clean = text.replace('\n', ' ').trim();
        return clean.length() > 90 ? clean.substring(0, 87) + "…" : clean;
    }
}
