package com.remindit.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import java.util.Calendar;

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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) return false;

        PendingIntent fireIntent = pending(context, reminder.id);
        manager.cancel(fireIntent);
        AlarmManager.AlarmClockInfo info = new AlarmManager.AlarmClockInfo(
                reminder.remindAt,
                showPending(context, reminder.id)
        );
        manager.setAlarmClock(info, fireIntent);
        return true;
    }

    public static void cancel(Context context, long reminderId) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager != null) manager.cancel(pending(context, reminderId));
    }

    public static long nextOccurrence(Reminder reminder, long fromMillis) {
        if (reminder == null || reminder.repeatMode == null || Reminder.REPEAT_ONCE.equals(reminder.repeatMode)) {
            return -1L;
        }

        Calendar calendar = Calendar.getInstance();
        long base = Math.max(fromMillis, reminder.remindAt);
        calendar.setTimeInMillis(base);

        if (Reminder.REPEAT_DAILY.equals(reminder.repeatMode)) {
            calendar.add(Calendar.DAY_OF_YEAR, 1);
            return calendar.getTimeInMillis();
        }
        if (Reminder.REPEAT_WEEKLY.equals(reminder.repeatMode)) {
            calendar.add(Calendar.DAY_OF_YEAR, 7);
            return calendar.getTimeInMillis();
        }
        if (Reminder.REPEAT_WEEKDAYS.equals(reminder.repeatMode)) {
            do {
                calendar.add(Calendar.DAY_OF_YEAR, 1);
            } while (calendar.get(Calendar.DAY_OF_WEEK) == Calendar.SATURDAY
                    || calendar.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY);
            return calendar.getTimeInMillis();
        }
        return -1L;
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
