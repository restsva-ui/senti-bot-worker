package com.remindit.app;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.Locale;

public final class LanguageManager {
    private static final String PREFS = "remindit_settings";
    private static final String KEY_LANGUAGE = "language";

    private LanguageManager() {}

    public static String getLanguage(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String saved = prefs.getString(KEY_LANGUAGE, null);
        if ("uk".equals(saved) || "en".equals(saved)) {
            return saved;
        }
        return "uk".equalsIgnoreCase(Locale.getDefault().getLanguage()) ? "uk" : "en";
    }

    public static boolean isUkrainian(Context context) {
        return "uk".equals(getLanguage(context));
    }

    public static String text(Context context, String english, String ukrainian) {
        return isUkrainian(context) ? ukrainian : english;
    }

    public static Locale locale(Context context) {
        return isUkrainian(context) ? new Locale("uk", "UA") : Locale.ENGLISH;
    }

    public static void setLanguage(Context context, String language) {
        if (!"uk".equals(language) && !"en".equals(language)) {
            return;
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_LANGUAGE, language)
                .apply();
    }
}
