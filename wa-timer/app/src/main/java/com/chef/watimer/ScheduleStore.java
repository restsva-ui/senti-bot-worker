package com.chef.watimer;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

public final class ScheduleStore {
    private static final String PREFS = "wa_timer_schedules";
    private static final String KEY = "items";

    private ScheduleStore() {}

    public static synchronized List<ScheduledMessage> getAll(Context context) {
        List<ScheduledMessage> out = new ArrayList<>();
        String raw = prefs(context).getString(KEY, "[]");
        try {
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o != null) out.add(ScheduledMessage.fromJson(o));
            }
        } catch (Exception ignored) {}
        Collections.sort(out, Comparator.comparingLong(a -> a.triggerAtMillis));
        return out;
    }

    public static synchronized ScheduledMessage get(Context context, long id) {
        for (ScheduledMessage m : getAll(context)) {
            if (m.id == id) return m;
        }
        return null;
    }

    public static synchronized void upsert(Context context, ScheduledMessage item) {
        List<ScheduledMessage> all = getAll(context);
        boolean replaced = false;
        for (int i = 0; i < all.size(); i++) {
            if (all.get(i).id == item.id) {
                all.set(i, item);
                replaced = true;
                break;
            }
        }
        if (!replaced) all.add(item);
        saveAll(context, all);
    }

    public static synchronized void delete(Context context, long id) {
        List<ScheduledMessage> all = getAll(context);
        all.removeIf(item -> item.id == id);
        saveAll(context, all);
    }

    private static void saveAll(Context context, List<ScheduledMessage> all) {
        JSONArray arr = new JSONArray();
        for (ScheduledMessage item : all) {
            try { arr.put(item.toJson()); } catch (Exception ignored) {}
        }
        prefs(context).edit().putString(KEY, arr.toString()).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
