package com.remindit.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

public final class AlarmDiagnostics {
    private static final String PREFS = "remindit_diagnostics";
    private static final String KEY_SCHEDULED = "alarm_test_scheduled_at";
    private static final String KEY_FIRED = "alarm_test_fired_at";
    private static final int REQUEST_CODE = 9042;

    private AlarmDiagnostics() {}

    public static boolean scheduleTwoMinuteTest(Context context) {
        if (!ReminderScheduler.canScheduleExactly(context)) return false;
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return false;

        long at = System.currentTimeMillis() + 2 * 60_000L;
        Intent intent = new Intent(context, AlarmTestReceiver.class);
        intent.putExtra("scheduled_at", at);
        PendingIntent pending = PendingIntent.getBroadcast(
                context,
                REQUEST_CODE,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        manager.cancel(pending);
        AlarmManager.AlarmClockInfo info = new AlarmManager.AlarmClockInfo(at, showPending(context));
        manager.setAlarmClock(info, pending);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putLong(KEY_SCHEDULED, at).apply();
        return true;
    }

    public static void markFired(Context context, long at) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putLong(KEY_FIRED, at).apply();
    }

    public static long lastScheduled(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_SCHEDULED, 0L);
    }

    public static long lastFired(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_FIRED, 0L);
    }

    private static PendingIntent showPending(Context context) {
        Intent intent = new Intent(context, SettingsActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
                context,
                REQUEST_CODE + 1,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
