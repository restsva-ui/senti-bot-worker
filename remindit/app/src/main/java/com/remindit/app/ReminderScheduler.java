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

        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) return false;

        cancel(context, reminder.id);
        long now = System.currentTimeMillis();
        int scheduled = 0;
        for (ReminderTiming.Alert alert : ReminderTiming.alerts(reminder)) {
            if (alert.at <= now) continue;
            scheduleAt(context, manager, reminder.id, alert.stage, alert.at);
            scheduled++;
        }
        if (reminder.snoozeAt > now) {
            scheduleAt(context, manager, reminder.id, ReminderTiming.STAGE_SNOOZE, reminder.snoozeAt);
            scheduled++;
        }
        return scheduled > 0;
    }

    private static void scheduleAt(Context context, AlarmManager manager, long reminderId, int stage, long at) {
        PendingIntent fireIntent = pending(context, reminderId, stage);
        AlarmManager.AlarmClockInfo info = new AlarmManager.AlarmClockInfo(
                at,
                showPending(context, reminderId)
        );
        manager.setAlarmClock(info, fireIntent);
    }

    public static void cancel(Context context, long reminderId) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        for (int stage = ReminderTiming.STAGE_SECONDARY; stage <= ReminderTiming.STAGE_SNOOZE; stage++) {
            manager.cancel(pending(context, reminderId, stage));
        }
    }

    public static long nextOccurrence(Reminder reminder, long fromMillis) {
        if (reminder == null || reminder.repeatMode == null || Reminder.REPEAT_ONCE.equals(reminder.repeatMode)) {
            return -1L;
        }

        Calendar calendar = Calendar.getInstance();
        calendar.setTimeInMillis(reminder.remindAt);

        if (Reminder.REPEAT_DAILY.equals(reminder.repeatMode)) {
            do {
                calendar.add(Calendar.DAY_OF_YEAR, 1);
            } while (calendar.getTimeInMillis() <= fromMillis);
            return calendar.getTimeInMillis();
        }
        if (Reminder.REPEAT_WEEKLY.equals(reminder.repeatMode)) {
            do {
                calendar.add(Calendar.DAY_OF_YEAR, 7);
            } while (calendar.getTimeInMillis() <= fromMillis);
            return calendar.getTimeInMillis();
        }
        if (Reminder.REPEAT_WEEKDAYS.equals(reminder.repeatMode)) {
            do {
                calendar.add(Calendar.DAY_OF_YEAR, 1);
            } while (calendar.get(Calendar.DAY_OF_WEEK) == Calendar.SATURDAY
                    || calendar.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY
                    || calendar.getTimeInMillis() <= fromMillis);
            return calendar.getTimeInMillis();
        }
        return -1L;
    }

    private static PendingIntent pending(Context context, long reminderId, int stage) {
        Intent intent = new Intent(context, ReminderReceiver.class);
        intent.setAction(ACTION_FIRE);
        intent.putExtra("reminder_id", reminderId);
        intent.putExtra("alert_stage", stage);
        int requestCode = requestCode(reminderId, stage);
        return PendingIntent.getBroadcast(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static int requestCode(long reminderId, int stage) {
        int base = (int) (reminderId ^ (reminderId >>> 32));
        return base * 8 + stage;
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
