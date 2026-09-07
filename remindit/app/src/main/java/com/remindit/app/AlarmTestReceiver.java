package com.remindit.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public class AlarmTestReceiver extends BroadcastReceiver {
    private static final String CHANNEL_ID = "remindit_alarm_test_v1";

    @Override
    public void onReceive(Context context, Intent intent) {
        long firedAt = System.currentTimeMillis();
        AlarmDiagnostics.markFired(context, firedAt);

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    LanguageManager.pick(context, "Перевірка RemindIt", "RemindIt test"),
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.setSound(null, null);
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);
        }

        String message = LanguageManager.pick(context,
                "Точне нагадування працює. Перевірку пройдено.",
                "Exact reminders work. The test passed.");
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, CHANNEL_ID)
                : new Notification.Builder(context);
        builder.setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("RemindIt")
                .setContentText(message)
                .setStyle(new Notification.BigTextStyle().bigText(message))
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_REMINDER)
                .setPriority(Notification.PRIORITY_HIGH)
                .setVisibility(Notification.VISIBILITY_PUBLIC);
        manager.notify(9042, builder.build());
        ReminderSound.playBlocking();
    }
}
