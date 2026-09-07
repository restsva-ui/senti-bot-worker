package com.remindit.app;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

public final class ReminderTiming {
    public static final int STAGE_SECONDARY = 0;
    public static final int STAGE_PRIMARY = 1;
    public static final int STAGE_EVENT = 2;
    public static final int STAGE_FOLLOW_UP_1 = 3;
    public static final int STAGE_FOLLOW_UP_2 = 4;
    public static final int STAGE_SNOOZE = 5;

    private static final long MINUTE_MS = 60_000L;

    public static final class Defaults {
        public final int leadMinutes;
        public final int secondLeadMinutes;
        public final int followUpMinutes;

        Defaults(int leadMinutes, int secondLeadMinutes, int followUpMinutes) {
            this.leadMinutes = leadMinutes;
            this.secondLeadMinutes = secondLeadMinutes;
            this.followUpMinutes = followUpMinutes;
        }
    }

    public static final class Alert {
        public final int stage;
        public final long at;

        Alert(int stage, long at) {
            this.stage = stage;
            this.at = at;
        }
    }

    private ReminderTiming() {}

    public static Defaults defaultsFor(String intentType) {
        if ("appointment".equals(intentType)) return new Defaults(120, 1440, 30);
        if ("travel".equals(intentType)) return new Defaults(120, 1440, 0);
        if ("payment".equals(intentType)) return new Defaults(1440, 120, 60);
        if ("call".equals(intentType) || "reply".equals(intentType)) return new Defaults(10, -1, 15);
        if ("task".equals(intentType)) return new Defaults(60, 1440, 30);
        if ("shopping".equals(intentType) || "review".equals(intentType)) return new Defaults(60, -1, 0);
        return new Defaults(0, -1, 15);
    }

    public static List<Alert> alerts(Reminder reminder) {
        TreeMap<Long, Integer> planned = new TreeMap<>();
        if (reminder == null || reminder.remindAt <= 0) return new ArrayList<>();

        addLead(planned, reminder.remindAt, reminder.secondLeadMinutes, STAGE_SECONDARY);
        addLead(planned, reminder.remindAt, reminder.leadMinutes, STAGE_PRIMARY);
        planned.put(reminder.remindAt, STAGE_EVENT);

        if (!reminder.isRepeating() && reminder.followUpMinutes > 0) {
            long step = reminder.followUpMinutes * MINUTE_MS;
            planned.put(reminder.remindAt + step, STAGE_FOLLOW_UP_1);
            planned.put(reminder.remindAt + step * 2L, STAGE_FOLLOW_UP_2);
        }

        ArrayList<Alert> result = new ArrayList<>();
        for (Map.Entry<Long, Integer> entry : planned.entrySet()) {
            result.add(new Alert(entry.getValue(), entry.getKey()));
        }
        return result;
    }

    private static void addLead(TreeMap<Long, Integer> planned, long eventAt, int minutes, int stage) {
        if (minutes <= 0) return;
        long at = eventAt - minutes * MINUTE_MS;
        if (at > 0) planned.put(at, stage);
    }
}
