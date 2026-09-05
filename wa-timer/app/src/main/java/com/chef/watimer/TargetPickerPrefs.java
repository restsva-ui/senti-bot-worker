package com.chef.watimer;

import android.content.Context;
import android.content.SharedPreferences;

public final class TargetPickerPrefs {
    private static final String PREFS = "wa_timer_target_picker";
    private static final String ACTIVE = "active";
    private static final String BUSINESS = "business";
    private static final String READY = "ready";
    private static final String SELECTED_NAME = "selected_name";
    private static final String SELECTED_BUSINESS = "selected_business";

    private TargetPickerPrefs() {}

    public static void begin(Context context, boolean useBusiness) {
        p(context).edit()
                .putBoolean(ACTIVE, true)
                .putBoolean(BUSINESS, useBusiness)
                .putBoolean(READY, false)
                .remove(SELECTED_NAME)
                .apply();
    }

    public static boolean isActive(Context context) {
        return p(context).getBoolean(ACTIVE, false);
    }

    public static boolean useBusiness(Context context) {
        return p(context).getBoolean(BUSINESS, false);
    }

    public static void complete(Context context, String name) {
        boolean business = useBusiness(context);
        p(context).edit()
                .putBoolean(ACTIVE, false)
                .putBoolean(READY, true)
                .putString(SELECTED_NAME, name)
                .putBoolean(SELECTED_BUSINESS, business)
                .apply();
    }

    public static boolean hasSelection(Context context) {
        return p(context).getBoolean(READY, false);
    }

    public static String getSelectedName(Context context) {
        return p(context).getString(SELECTED_NAME, "");
    }

    public static boolean getSelectedBusiness(Context context) {
        return p(context).getBoolean(SELECTED_BUSINESS, false);
    }

    public static void clearSelection(Context context) {
        p(context).edit()
                .putBoolean(READY, false)
                .remove(SELECTED_NAME)
                .apply();
    }

    public static void cancel(Context context) {
        p(context).edit().putBoolean(ACTIVE, false).apply();
    }

    private static SharedPreferences p(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
