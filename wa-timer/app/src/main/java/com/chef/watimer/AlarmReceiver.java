package com.chef.watimer;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        long id = intent.getLongExtra("schedule_id", -1L);
        ScheduledMessage item = ScheduleStore.get(context, id);
        if (item == null || !item.enabled) return;

        item.lastStatus = "Запуск…";
        ScheduleStore.upsert(context, item);
        AutomationPrefs.setPending(context, id);

        if (AutomationLauncher.canInteractNow(context)) {
            boolean launched = AutomationLauncher.launchWhatsApp(context, item);
            if (!launched) {
                item.lastStatus = "WhatsApp не знайдено";
                ScheduleStore.upsert(context, item);
                AutomationPrefs.clear(context);
                NotificationHelper.show(context, "4.5.0", "Не вдалося відкрити WhatsApp");
            }
        } else {
            item.lastStatus = "Очікує розблокування";
            ScheduleStore.upsert(context, item);
            NotificationHelper.show(context, "4.5.0", "Розблокуйте телефон — повідомлення готове до надсилання");
        }

        if (ScheduledMessage.REPEAT_ONCE.equals(item.repeatMode)) {
            item.enabled = false;
        } else {
            long next = ScheduleEngine.computeNext(item, System.currentTimeMillis());
            item.triggerAtMillis = next;
        }

        ScheduleStore.upsert(context, item);
        if (item.enabled) {
            ScheduleEngine.schedule(context, item);
        }
    }
}
