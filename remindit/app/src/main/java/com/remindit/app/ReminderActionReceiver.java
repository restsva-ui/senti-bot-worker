package com.remindit.app;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import java.util.Calendar;

public class ReminderActionReceiver extends BroadcastReceiver {
    public static final String ACTION_DONE = "com.remindit.app.ACTION_DONE";
    public static final String ACTION_SNOOZE_10 = "com.remindit.app.ACTION_SNOOZE_10";
    public static final String ACTION_SNOOZE_60 = "com.remindit.app.ACTION_SNOOZE_60";
    public static final String ACTION_TOMORROW = "com.remindit.app.ACTION_TOMORROW";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        long id = intent.getLongExtra("reminder_id", -1L);
        if (id < 0) return;

        ReminderDb db = new ReminderDb(context);
        Reminder reminder = db.get(id);
        if (reminder == null) return;
        long occurrenceAt = intent.getLongExtra("occurrence_at", reminder.remindAt);

        String action = intent.getAction();
        if (ACTION_DONE.equals(action)) {
            if (!reminder.isRepeating()) {
                ReminderScheduler.cancel(context, id);
                db.markDone(id);
            } else if (reminder.remindAt <= occurrenceAt + 1000L) {
                ReminderScheduler.cancel(context, id);
                long next = ReminderScheduler.nextOccurrence(reminder, occurrenceAt);
                if (next > 0) {
                    reminder.remindAt = next;
                    db.update(reminder);
                    ReminderScheduler.schedule(context, reminder);
                }
            }
            cancelNotification(context, id);
            return;
        }

        if (ACTION_SNOOZE_10.equals(action)) {
            snooze(context, reminder, 10 * 60_000L);
        } else if (ACTION_SNOOZE_60.equals(action)) {
            snooze(context, reminder, 60 * 60_000L);
        } else if (ACTION_TOMORROW.equals(action)) {
            ReminderScheduler.cancel(context, id);
            Calendar c = Calendar.getInstance();
            c.setTimeInMillis(reminder.remindAt);
            do {
                c.add(Calendar.DAY_OF_YEAR, 1);
            } while (c.getTimeInMillis() <= System.currentTimeMillis());
            reminder.remindAt = c.getTimeInMillis();
            reminder.done = false;
            reminder.completedAt = 0;
            db.update(reminder);
            ReminderScheduler.schedule(context, reminder);
            cancelNotification(context, id);
        }
    }

    private void snooze(Context context, Reminder reminder, long delay) {
        ReminderScheduler.scheduleSnooze(context, reminder.id, System.currentTimeMillis() + delay);
        cancelNotification(context, reminder.id);
    }

    private void cancelNotification(Context context, long id) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(notificationId(id));
    }

    public static int notificationId(long id) {
        return (int) (id ^ (id >>> 32));
    }
}
