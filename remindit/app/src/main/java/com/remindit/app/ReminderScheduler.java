package com.remindit.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public final class ReminderScheduler {
    private static final String ACTION_FIRE = "com.remindit.app.ACTION_FIRE_REMINDER";

    private ReminderScheduler() {}

    public static boolean canScheduleExactly(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        return manager != null && manager.canScheduleExactAlarms();
    }

    public static boolean schedule(Context context, Reminder reminder) {
        if (reminder == null || reminder.id <= 0 || reminder.done) return false;
        if (reminder.remindAt <= System.currentTimeMillis()) return false;

        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return false;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) {
            return false;
        }

        PendingIntent fireIntent = pending(context, reminder.id);
        manager.cancel(fireIntent);

        // AlarmClock is intentionally used here instead of a normal exact alarm.
        // It is the strongest user-visible exact-alarm mode Android provides and
        // is allowed to wake the device out of idle/doze for a real reminder.
        AlarmManager.AlarmClockInfo alarmClockInfo = new AlarmManager.AlarmClockInfo(
                reminder.remindAt,
                showPending(context, reminder.id)
        );
        manager.setAlarmClock(alarmClockInfo, fireIntent);
        return true;
    }

    public static void cancel(Context context, long reminderId) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager != null) manager.cancel(pending(context, reminderId));
    }

    private static PendingIntent pending(Context context, long reminderId) {
        Intent intent = new Intent(context, ReminderReceiver.class);
        intent.setAction(ACTION_FIRE);
        intent.putExtra("reminder_id", reminderId);
        int requestCode = (int) (reminderId ^ (reminderId >>> 32));
        return PendingIntent.getBroadcast(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static PendingIntent showPending(Context context, long reminderId) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int requestCode = 100000 + (int) (reminderId ^ (reminderId >>> 32));
        return PendingIntent.getActivity(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
