package com.chef.watimer;

import android.content.Context;
import android.content.SharedPreferences;

public final class AutomationPrefs {
    private static final String PREFS = "wa_timer_automation";
    private static final String ID = "pending_id";
    private static final String STAGE = "stage";
    private static final String STARTED = "started";
    private static final String ATTEMPTS = "attempts";

    private AutomationPrefs() {}

    public static void setPending(Context context, long id) {
        p(context).edit()
                .putLong(ID, id)
                .putInt(STAGE, 0)
                .putLong(STARTED, System.currentTimeMillis())
                .putInt(ATTEMPTS, 0)
                .apply();
    }

    public static long getPendingId(Context context) { return p(context).getLong(ID, -1L); }
    public static int getStage(Context context) { return p(context).getInt(STAGE, 0); }
    public static void setStage(Context context, int stage) { p(context).edit().putInt(STAGE, stage).apply(); }
    public static long getStarted(Context context) { return p(context).getLong(STARTED, 0L); }
    public static int incrementAttempts(Context context) {
        int v = p(context).getInt(ATTEMPTS, 0) + 1;
        p(context).edit().putInt(ATTEMPTS, v).apply();
        return v;
    }
    public static int getAttempts(Context context) { return p(context).getInt(ATTEMPTS, 0); }

    public static void clear(Context context) {
        p(context).edit().clear().apply();
    }

    private static SharedPreferences p(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
