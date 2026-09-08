package com.remindit.app;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.Locale;

public final class LanguageManager {
    public static final String UK = "uk";
    public static final String EN = "en";

    private static final String PREFS = "remindit_settings";
    private static final String KEY_LANGUAGE = "language";

    private LanguageManager() {}

    public static String getLanguage(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String saved = prefs.getString(KEY_LANGUAGE, null);
        if (UK.equals(saved) || EN.equals(saved)) return saved;
        return UK.equalsIgnoreCase(Locale.getDefault().getLanguage()) ? UK : EN;
    }

    public static String get(Context context) {
        return getLanguage(context);
    }

    public static boolean isUkrainian(Context context) {
        return UK.equals(getLanguage(context));
    }

    public static boolean isUk(Context context) {
        return isUkrainian(context);
    }

    public static String text(Context context, String english, String ukrainian) {
        return isUkrainian(context) ? ukrainian : english;
    }

    public static String pick(Context context, String ukrainian, String english) {
        return isUkrainian(context) ? ukrainian : english;
    }

    public static Locale locale(Context context) {
        return isUkrainian(context) ? new Locale("uk", "UA") : Locale.ENGLISH;
    }

    public static Locale displayLocale(Context context) {
        return locale(context);
    }

    public static void setLanguage(Context context, String language) {
        if (!UK.equals(language) && !EN.equals(language)) return;
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(KEY_LANGUAGE, language).apply();
    }

    public static void set(Context context, String language) {
        setLanguage(context, language);
    }

    public static String[] categories(Context context) {
        return isUkrainian(context)
                ? new String[]{"Особисте", "Покупки", "Подорожі", "Робота", "Платежі", "Інше"}
                : new String[]{"Personal", "Shopping", "Travel", "Work", "Bills", "Other"};
    }

    public static String categoryKeyFromDisplay(String display) {
        if (display == null) return "Personal";
        if ("Особисте".equals(display) || "Personal".equals(display)) return "Personal";
        if ("Покупки".equals(display) || "Shopping".equals(display)) return "Shopping";
        if ("Подорожі".equals(display) || "Travel".equals(display)) return "Travel";
        if ("Робота".equals(display) || "Work".equals(display)) return "Work";
        if ("Платежі".equals(display) || "Bills".equals(display)) return "Bills";
        if ("Інше".equals(display) || "Other".equals(display)) return "Other";
        return display;
    }

    public static String categoryDisplay(Context context, String key) {
        if (!isUkrainian(context)) return key == null ? "Personal" : key;
        if ("Shopping".equals(key)) return "Покупки";
        if ("Travel".equals(key)) return "Подорожі";
        if ("Work".equals(key)) return "Робота";
        if ("Bills".equals(key)) return "Платежі";
        if ("Other".equals(key)) return "Інше";
        return "Особисте";
    }
}
