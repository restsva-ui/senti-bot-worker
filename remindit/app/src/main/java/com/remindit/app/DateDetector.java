package com.remindit.app;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class DateDetector {
    private static final Pattern DMY = Pattern.compile(
            "\\b(\\d{1,2})[./-](\\d{1,2})[./-](\\d{2,4})(?:\\s+(?:о\\s*)?(\\d{1,2})[:.](\\d{2}))?"
    );
    private static final Pattern YMD = Pattern.compile(
            "\\b(20\\d{2})-(\\d{1,2})-(\\d{1,2})(?:[ T](\\d{1,2}):(\\d{2}))?"
    );
    private static final Pattern TIME = Pattern.compile("\\b([01]?\\d|2[0-3]):([0-5]\\d)\\b");
    private static final Pattern WORD_DATE = Pattern.compile(
            "\\b(\\d{1,2})\\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня|" +
                    "january|february|march|april|may|june|july|august|september|october|november|december|" +
                    "jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)" +
                    "(?:\\s+(20\\d{2}))?(?:[,\\s]+(?:о\\s*)?(\\d{1,2}):([0-5]\\d))?",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );

    private DateDetector() {}

    public static long detect(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return -1L;
        }

        String text = raw.toLowerCase(Locale.ROOT);
        ZoneId zone = ZoneId.systemDefault();
        ZonedDateTime now = ZonedDateTime.now(zone);

        Matcher ymd = YMD.matcher(text);
        if (ymd.find()) {
            int year = intOf(ymd.group(1));
            int month = intOf(ymd.group(2));
            int day = intOf(ymd.group(3));
            int hour = ymd.group(4) == null ? 9 : intOf(ymd.group(4));
            int minute = ymd.group(5) == null ? 0 : intOf(ymd.group(5));
            return safeEpoch(year, month, day, hour, minute, zone);
        }

        Matcher dmy = DMY.matcher(text);
        if (dmy.find()) {
            int day = intOf(dmy.group(1));
            int month = intOf(dmy.group(2));
            int year = intOf(dmy.group(3));
            if (year < 100) {
                year += 2000;
            }
            int hour = dmy.group(4) == null ? 9 : intOf(dmy.group(4));
            int minute = dmy.group(5) == null ? 0 : intOf(dmy.group(5));
            return safeEpoch(year, month, day, hour, minute, zone);
        }

        Matcher wordDate = WORD_DATE.matcher(text);
        if (wordDate.find()) {
            int day = intOf(wordDate.group(1));
            int month = monthNumber(wordDate.group(2));
            int year = wordDate.group(3) == null ? now.getYear() : intOf(wordDate.group(3));
            int hour = wordDate.group(4) == null ? 9 : intOf(wordDate.group(4));
            int minute = wordDate.group(5) == null ? 0 : intOf(wordDate.group(5));

            long candidate = safeEpoch(year, month, day, hour, minute, zone);
            if (candidate > 0 && candidate < System.currentTimeMillis() && wordDate.group(3) == null) {
                candidate = safeEpoch(year + 1, month, day, hour, minute, zone);
            }
            return candidate;
        }

        if (text.contains("завтра") || text.contains("tomorrow")) {
            LocalDate date = now.toLocalDate().plusDays(1);
            LocalTime time = findTime(text, LocalTime.of(9, 0));
            return LocalDateTime.of(date, time).atZone(zone).toInstant().toEpochMilli();
        }

        if (text.contains("сьогодні") || text.contains("today")) {
            LocalDate date = now.toLocalDate();
            LocalTime time = findTime(text, now.toLocalTime().plusHours(1).withSecond(0).withNano(0));
            long value = LocalDateTime.of(date, time).atZone(zone).toInstant().toEpochMilli();
            if (value <= System.currentTimeMillis()) {
                value = LocalDateTime.of(date.plusDays(1), time).atZone(zone).toInstant().toEpochMilli();
            }
            return value;
        }

        Matcher timeMatcher = TIME.matcher(text);
        if (timeMatcher.find()) {
            LocalTime time = LocalTime.of(intOf(timeMatcher.group(1)), intOf(timeMatcher.group(2)));
            LocalDate date = now.toLocalDate();
            long value = LocalDateTime.of(date, time).atZone(zone).toInstant().toEpochMilli();
            if (value <= System.currentTimeMillis()) {
                value = LocalDateTime.of(date.plusDays(1), time).atZone(zone).toInstant().toEpochMilli();
            }
            return value;
        }

        return -1L;
    }

    public static String inferCategory(String raw) {
        if (raw == null) {
            return "Personal";
        }
        String text = raw.toLowerCase(Locale.ROOT);

        if (containsAny(text, "flight", "рейс", "квиток", "ticket", "hotel", "готель", "train", "поїзд")) {
            return "Travel";
        }
        if (containsAny(text, "buy", "купити", "price", "ціна", "sale", "знижка", "магазин", "shop")) {
            return "Shopping";
        }
        if (containsAny(text, "invoice", "рахунок", "оплат", "bill", "payment", "комунал")) {
            return "Bills";
        }
        if (containsAny(text, "meeting", "робот", "work", "project", "проєкт", "client", "клієнт")) {
            return "Work";
        }
        return "Personal";
    }

    private static boolean containsAny(String text, String... values) {
        for (String value : values) {
            if (text.contains(value)) {
                return true;
            }
        }
        return false;
    }

    private static LocalTime findTime(String text, LocalTime fallback) {
        Matcher matcher = TIME.matcher(text);
        if (matcher.find()) {
            return LocalTime.of(intOf(matcher.group(1)), intOf(matcher.group(2)));
        }
        return fallback;
    }

    private static long safeEpoch(int year, int month, int day, int hour, int minute, ZoneId zone) {
        try {
            return LocalDateTime.of(year, month, day, hour, minute)
                    .atZone(zone)
                    .toInstant()
                    .toEpochMilli();
        } catch (Exception ignored) {
            return -1L;
        }
    }

    private static int intOf(String value) {
        return Integer.parseInt(value);
    }

    private static int monthNumber(String value) {
        Map<String, Integer> months = new HashMap<>();
        months.put("січня", 1);
        months.put("лютого", 2);
        months.put("березня", 3);
        months.put("квітня", 4);
        months.put("травня", 5);
        months.put("червня", 6);
        months.put("липня", 7);
        months.put("серпня", 8);
        months.put("вересня", 9);
        months.put("жовтня", 10);
        months.put("листопада", 11);
        months.put("грудня", 12);

        months.put("january", 1); months.put("jan", 1);
        months.put("february", 2); months.put("feb", 2);
        months.put("march", 3); months.put("mar", 3);
        months.put("april", 4); months.put("apr", 4);
        months.put("may", 5);
        months.put("june", 6); months.put("jun", 6);
        months.put("july", 7); months.put("jul", 7);
        months.put("august", 8); months.put("aug", 8);
        months.put("september", 9); months.put("sep", 9); months.put("sept", 9);
        months.put("october", 10); months.put("oct", 10);
        months.put("november", 11); months.put("nov", 11);
        months.put("december", 12); months.put("dec", 12);

        Integer month = months.get(value.toLowerCase(Locale.ROOT));
        return month == null ? 1 : month;
    }
}
