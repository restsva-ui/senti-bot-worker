package com.chef.watimer;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import java.util.Calendar;

public final class ScheduleEngine {
    private ScheduleEngine() {}

    public static void schedule(Context context, ScheduledMessage item) {
        if (!item.enabled || item.triggerAtMillis <= 0) return;
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = alarmPendingIntent(context, item.id);
        long when = item.triggerAtMillis;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
        } else {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
        }
    }

    public static void cancel(Context context, long id) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        am.cancel(alarmPendingIntent(context, id));
    }

    public static long computeNext(ScheduledMessage item, long now) {
        if (ScheduledMessage.REPEAT_ONCE.equals(item.repeatMode)) return -1L;
        Calendar base = Calendar.getInstance();
        base.setTimeInMillis(item.triggerAtMillis);
        int hour = base.get(Calendar.HOUR_OF_DAY);
        int minute = base.get(Calendar.MINUTE);

        Calendar next = Calendar.getInstance();
        next.setTimeInMillis(now);
        next.set(Calendar.HOUR_OF_DAY, hour);
        next.set(Calendar.MINUTE, minute);
        next.set(Calendar.SECOND, 0);
        next.set(Calendar.MILLISECOND, 0);
        if (next.getTimeInMillis() <= now) next.add(Calendar.DAY_OF_YEAR, 1);

        if (ScheduledMessage.REPEAT_WEEKDAYS.equals(item.repeatMode)) {
            while (next.get(Calendar.DAY_OF_WEEK) == Calendar.SATURDAY ||
                    next.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY) {
                next.add(Calendar.DAY_OF_YEAR, 1);
            }
        }
        return next.getTimeInMillis();
    }

    public static void rescheduleAll(Context context) {
        long now = System.currentTimeMillis();
        for (ScheduledMessage item : ScheduleStore.getAll(context)) {
            if (!item.enabled) continue;
            if (item.triggerAtMillis <= now) {
                long next = computeNext(item, now);
                if (next < 0) {
                    item.enabled = false;
                    item.lastStatus = "Час минув";
                    ScheduleStore.upsert(context, item);
                    continue;
                }
                item.triggerAtMillis = next;
                ScheduleStore.upsert(context, item);
            }
            schedule(context, item);
        }
    }

    private static PendingIntent alarmPendingIntent(Context context, long id) {
        Intent i = new Intent(context, AlarmReceiver.class);
        i.putExtra("schedule_id", id);
        int requestCode = (int) (id ^ (id >>> 32));
        return PendingIntent.getBroadcast(
                context,
                requestCode,
                i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
