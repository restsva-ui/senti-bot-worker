package com.remindit.app;

import android.app.AlarmManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class ExactAlarmPermissionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        if (!AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED.equals(intent.getAction())) {
            return;
        }
        if (ReminderScheduler.canScheduleExactly(context)) {
            long now = System.currentTimeMillis();
            for (Reminder reminder : new ReminderDb(context).getFuturePending(now)) {
                ReminderScheduler.schedule(context, reminder);
            }
        }
    }
}
