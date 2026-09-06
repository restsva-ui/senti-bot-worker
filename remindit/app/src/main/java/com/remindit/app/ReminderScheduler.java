package com.remindit.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public final class ReminderScheduler {
    private ReminderScheduler() {}

    public static void schedule(Context context, Reminder reminder) {
        AlarmManager alarmManager =
                (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);

        PendingIntent pendingIntent = pendingIntent(context, reminder.id);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && !alarmManager.canScheduleExactAlarms()) {
            alarmManager.setAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    reminder.remindAt,
                    pendingIntent
            );
            return;
        }

        alarmManager.setExactAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                reminder.remindAt,
                pendingIntent
        );
    }

    public static void cancel(Context context, long id) {
        AlarmManager alarmManager =
                (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        alarmManager.cancel(pendingIntent(context, id));
    }

    private static PendingIntent pendingIntent(Context context, long id) {
        Intent intent = new Intent(context, ReminderReceiver.class);
        intent.putExtra("reminder_id", id);

        int requestCode = (int) (id ^ (id >>> 32));
        return PendingIntent.getBroadcast(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
