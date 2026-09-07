package com.remindit.app;

import android.content.Context;

import java.util.ArrayList;
import java.util.List;

public final class ReminderUi {
    public static final int[] LEAD_VALUES = {0, 10, 30, 60, 120, 1440};
    public static final int[] SECOND_LEAD_VALUES = {-1, 10, 30, 60, 120, 1440};
    public static final int[] FOLLOW_UP_VALUES = {0, 10, 15, 30, 60};

    private ReminderUi() {}

    public static String[] leadLabels(Context context, boolean optional) {
        if (LanguageManager.isUk(context)) {
            return optional
                    ? new String[]{"Вимкнено", "За 10 хв", "За 30 хв", "За 1 год", "За 2 год", "За 1 день"}
                    : new String[]{"У момент події", "За 10 хв", "За 30 хв", "За 1 год", "За 2 год", "За 1 день"};
        }
        return optional
                ? new String[]{"Off", "10 min before", "30 min before", "1 hour before", "2 hours before", "1 day before"}
                : new String[]{"At event time", "10 min before", "30 min before", "1 hour before", "2 hours before", "1 day before"};
    }

    public static String[] followUpLabels(Context context) {
        return LanguageManager.isUk(context)
                ? new String[]{"Не повторювати", "Кожні 10 хв • 2 рази", "Кожні 15 хв • 2 рази", "Кожні 30 хв • 2 рази", "Щогодини • 2 рази"}
                : new String[]{"Do not repeat", "Every 10 min • twice", "Every 15 min • twice", "Every 30 min • twice", "Hourly • twice"};
    }

    public static int indexOf(int[] values, int value) {
        for (int i = 0; i < values.length; i++) if (values[i] == value) return i;
        return 0;
    }

    public static String summary(Context context, Reminder reminder) {
        List<String> parts = new ArrayList<>();
        addLead(context, parts, reminder.secondLeadMinutes);
        addLead(context, parts, reminder.leadMinutes);
        parts.add(LanguageManager.pick(context, "у момент події", "at event time"));

        String leadSummary = joinDistinct(parts);
        if (!reminder.isRepeating() && reminder.followUpMinutes > 0) {
            return leadSummary + LanguageManager.pick(context,
                    " • якщо не виконано: ще 2 рази кожні " + duration(context, reminder.followUpMinutes),
                    " • if not done: twice more every " + duration(context, reminder.followUpMinutes));
        }
        return leadSummary;
    }

    private static void addLead(Context context, List<String> parts, int minutes) {
        if (minutes <= 0) return;
        parts.add(LanguageManager.pick(context, "за ", "") + duration(context, minutes)
                + LanguageManager.pick(context, "", " before"));
    }

    private static String duration(Context context, int minutes) {
        if (minutes == 1440) return LanguageManager.pick(context, "1 день", "1 day");
        if (minutes == 120) return LanguageManager.pick(context, "2 години", "2 hours");
        if (minutes == 60) return LanguageManager.pick(context, "1 годину", "1 hour");
        return minutes + LanguageManager.pick(context, " хв", " min");
    }

    private static String joinDistinct(List<String> values) {
        StringBuilder out = new StringBuilder();
        for (String value : values) {
            if (out.indexOf(value) >= 0) continue;
            if (out.length() > 0) out.append(" • ");
            out.append(value);
        }
        return out.toString();
    }
}
