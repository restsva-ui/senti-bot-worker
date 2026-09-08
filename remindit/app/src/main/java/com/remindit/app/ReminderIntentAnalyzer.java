package com.remindit.app;

import android.content.Context;
import android.text.TextUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

public final class ReminderIntentAnalyzer {
    private static final Pattern TIME_ONLY = Pattern.compile("^\\s*\\d{1,2}[:.]\\d{2}\\s*$");
    private static final Pattern LEADING_TIME = Pattern.compile("^\\s*\\d{1,2}[:.]\\d{2}\\s+");
    private static final Pattern DATEISH = Pattern.compile(".*\\b\\d{1,2}[./-]\\d{1,2}([./-]\\d{2,4})?\\b.*");
    private static final Pattern CLOCK_DETAIL = Pattern.compile(
            "(?:\\b(?:о|at)\\s*)?\\b(?:[01]?\\d|2[0-3])[:.]([0-5]\\d)\\b",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );
    private static final Pattern RELATIVE_DATE_DETAIL = Pattern.compile(
            "\\b(day\\s+after\\s+tomorrow|післязавтра|сьогодні|завтра|today|tomorrow)\\b",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );
    private static final Pattern RELATIVE_OFFSET_DETAIL = Pattern.compile(
            "\\b(?:через|in)\\s+\\d{1,3}\\s*(?:хв(?:илин(?:у|и)?)?|minutes?|mins?|мін|год(?:ину|ини|ин)?|hours?|hrs?|д(?:ень|ні|нів|ня)|days?)\\b",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );
    private static final Pattern WEEKDAY_DETAIL = Pattern.compile(
            "(?:\\b(?:у|в|on)\\s+)?\\b(понеділок|понеділка|вівторок|вівторка|середу|середа|четвер|четверга|п.?ятницю|п.?ятниця|суботу|субота|неділю|неділя|" +
                    "monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );
    private static final Pattern NUMERIC_DATE_DETAIL = Pattern.compile(
            "\\b(?:20\\d{2}-\\d{1,2}-\\d{1,2}|\\d{1,2}[./-]\\d{1,2}(?:[./-]\\d{2,4})?)\\b"
    );
    private static final Pattern URL = Pattern.compile("https?://\\S+", Pattern.CASE_INSENSITIVE);
    private static final Pattern STATUS_NOISE = Pattern.compile(
            ".*(\\b4g\\b|\\b5g\\b|volte|wi-?fi|battery|lifecell|kyivstar|vodafone|\\d{1,3}%|мб/с|kb/s).*",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );
    private static final Pattern UI_NOISE = Pattern.compile(
            ".*(підписник|підписат|прикріплене повідомлення|сповіщати|перегляд(?:ів)?|надіслати|реакц|коментар|telegram|whatsapp|написати повідомлення|додати реакцію|переслано).*",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );

    public static final class Result {
        public final String title;
        public final String goal;
        public final String categoryKey;
        public final String intentType;
        public final int confidence;

        Result(String title, String goal, String categoryKey, String intentType, int confidence) {
            this.title = title;
            this.goal = goal;
            this.categoryKey = categoryKey;
            this.intentType = intentType;
            this.confidence = confidence;
        }
    }

    private ReminderIntentAnalyzer() {}

    public static Result analyze(Context context, String rawText) {
        return analyze(context, rawText, "manual");
    }

    public static Result analyze(Context context, String rawText, String sourceType) {
        boolean uk = LanguageManager.isUk(context);
        String raw = rawText == null ? "" : rawText.trim();
        String withoutUrls = URL.matcher(raw).replaceAll(" ");
        List<String> lines = usefulLines(withoutUrls);
        String subject = chooseSubject(lines, withoutUrls);
        String lower = withoutUrls.toLowerCase(Locale.ROOT);

        String type = "remember";
        String category = DateDetector.inferCategory(withoutUrls);
        int confidence = 56;

        boolean channelLike = containsAny(lower,
                "підписник", "підписат", "прикріплене повідомлення", "канал", "переглядів");
        boolean articleLike = looksLikeArticle(lines);

        if (containsAny(lower,
                "оплат", "сплат", "рахунок", "квитанц", "борг", "грн", "₴",
                "invoice", "bill", "payment", "pay ", "due amount")) {
            type = "payment"; category = "Bills"; confidence = 94;
        } else if (containsAny(lower,
                "квиток", "рейс", "поїзд", "автобус", "виліт", "відправлення", "посадка",
                "ticket", "flight", "train", "bus", "departure", "boarding", "gate")) {
            type = "travel"; category = "Travel"; confidence = 92;
        } else if (containsAny(lower,
                "купити", "замовити", "ціна", "знижк", "акці", "кошик",
                "buy", "order", "price", "discount", "sale", "cart")) {
            type = "shopping"; category = "Shopping"; confidence = 90;
        } else if (containsAny(lower,
                "зателефон", "подзвон", "передзвон", "набрати номер", "call ", "call back")) {
            type = "call"; category = "Personal"; confidence = 92;
        } else if (containsAny(lower,
                "відповісти", "відписати", "відповідь на", "написати у відповідь", "reply", "respond", "text back")) {
            type = "reply"; category = "Personal"; confidence = 92;
        } else if (containsAny(lower,
                "зустріч", "лікар", "прийом", "запис", "бронювання", "візит",
                "meeting", "appointment", "doctor", "reservation", "booking")) {
            type = "appointment"; category = "Personal"; confidence = 91;
        } else if (containsAny(lower,
                "дедлайн", "зробити", "виконати", "подати", "здати", "завдання",
                "deadline", "task", "submit", "finish", "complete")) {
            type = "task"; category = "Work"; confidence = 88;
        } else if ("image".equals(sourceType) || "link".equals(sourceType) || channelLike || articleLike) {
            type = "review"; category = "Other"; confidence = articleLike ? 84 : 76;
        } else if (containsAny(lower,
                "нагад", "не забуд", "remember", "remind", "don't forget", "dont forget")) {
            type = "remember"; confidence = 78;
        }

        if (TextUtils.isEmpty(subject)) subject = fallbackSubject(uk, sourceType);
        String conciseSubject = stripScheduleDetails(subject);
        if (!conciseSubject.isEmpty()) subject = conciseSubject;

        String goal = buildGoal(uk, type, subject);
        String title = shorten(subject, 64);
        return new Result(title, goal, category, type, confidence);
    }

    public static String intentDisplay(Context context, String type) {
        boolean uk = LanguageManager.isUk(context);
        if ("payment".equals(type)) return uk ? "Оплата" : "Payment";
        if ("travel".equals(type)) return uk ? "Поїздка" : "Travel";
        if ("shopping".equals(type)) return uk ? "Покупка" : "Shopping";
        if ("call".equals(type)) return uk ? "Дзвінок" : "Call";
        if ("reply".equals(type)) return uk ? "Відповісти" : "Reply";
        if ("appointment".equals(type)) return uk ? "Подія" : "Appointment";
        if ("task".equals(type)) return uk ? "Завдання" : "Task";
        if ("review".equals(type)) return uk ? "Переглянути" : "Review";
        return uk ? "Не забути" : "Remember";
    }

    static String buildGoal(boolean uk, String type, String subject) {
        String clean = shorten(subject, 108);
        if (uk) {
            if ("payment".equals(type)) return naturalGoal(clean, "Оплатити", "оплатити", "сплатити");
            if ("travel".equals(type)) return naturalGoal(clean, "Не пропустити поїздку", "не пропустити");
            if ("shopping".equals(type)) return naturalGoal(clean, "Перевірити або купити", "купити", "замовити", "перевірити");
            if ("call".equals(type)) return naturalGoal(clean, "Зателефонувати", "зателефонувати", "подзвонити", "передзвонити");
            if ("reply".equals(type)) return naturalGoal(clean, "Відповісти", "відповісти", "відписати");
            if ("appointment".equals(type)) return ukrainianAppointmentGoal(clean);
            if ("task".equals(type)) return naturalGoal(clean, "Виконати", "виконати", "зробити", "подати", "здати");
            if ("review".equals(type)) return naturalGoal(clean, "Переглянути", "переглянути");
            return naturalGoal(clean, "Не забути", "не забути");
        }
        if ("payment".equals(type)) return naturalGoal(clean, "Pay", "pay", "settle");
        if ("travel".equals(type)) return naturalGoal(clean, "Don't miss the trip", "don't miss", "do not miss");
        if ("shopping".equals(type)) return naturalGoal(clean, "Check or buy", "buy", "order", "check");
        if ("call".equals(type)) return naturalGoal(clean, "Call", "call", "phone");
        if ("reply".equals(type)) return naturalGoal(clean, "Reply", "reply", "respond", "text back");
        if ("appointment".equals(type)) return naturalGoal(clean, "Don't miss the event", "don't miss", "do not miss");
        if ("task".equals(type)) return naturalGoal(clean, "Do", "do", "finish", "complete", "submit");
        if ("review".equals(type)) return naturalGoal(clean, "Review", "review");
        return naturalGoal(clean, "Remember", "remember");
    }

    private static List<String> usefulLines(String text) {
        ArrayList<String> result = new ArrayList<>();
        if (TextUtils.isEmpty(text)) return result;

        for (String original : text.replace('\r', '\n').split("\\n+")) {
            String line = LEADING_TIME.matcher(original.trim()).replaceFirst("");
            line = line.replaceAll("^[•·—–|:;\\-\\s]+", "")
                    .replaceAll("\\s+", " ").trim();
            if (line.length() < 5) continue;
            if (TIME_ONLY.matcher(line).matches()) continue;
            if (STATUS_NOISE.matcher(line).matches()) continue;
            if (UI_NOISE.matcher(line).matches()) continue;
            if (looksMostlyNumeric(line)) continue;
            if (looksGarbage(line)) continue;
            result.add(line);
        }
        return result;
    }

    private static String chooseSubject(List<String> lines, String fallback) {
        if (!lines.isEmpty()) {
            String best = "";
            int bestScore = Integer.MIN_VALUE;

            for (int i = 0; i < lines.size(); i++) {
                String combined = "";
                for (int width = 0; width < 3 && i + width < lines.size(); width++) {
                    if (!combined.isEmpty()) combined += " ";
                    combined += lines.get(i + width);
                    if (combined.length() > 190) break;
                    int score = scoreCandidate(combined);
                    if (score > bestScore) {
                        bestScore = score;
                        best = combined;
                    }
                }
            }
            return cleanSubject(best);
        }

        if (fallback == null) return "";
        String clean = fallback.replace('\n', ' ').replaceAll("\\s+", " ").trim();
        return looksGarbage(clean) ? "" : shorten(clean, 120);
    }

    private static int scoreCandidate(String value) {
        if (TextUtils.isEmpty(value)) return -999;
        if (UI_NOISE.matcher(value).matches() || STATUS_NOISE.matcher(value).matches()) return -400;

        int letters = 0;
        int cyr = 0;
        int latin = 0;
        int digits = 0;
        int words = 0;
        boolean inWord = false;

        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (Character.isLetter(c)) {
                letters++;
                if (isCyrillic(c)) cyr++; else latin++;
            }
            if (Character.isDigit(c)) digits++;
            if (Character.isLetterOrDigit(c)) {
                if (!inWord) words++;
                inWord = true;
            } else {
                inWord = false;
            }
        }

        if (letters < 8) return -200;
        int score = Math.min(letters, 95) + Math.min(words * 4, 48);
        if (cyr > 0 && latin > 0 && latin * 100 / Math.max(1, letters) > 25) score -= 45;
        if (digits * 100 / Math.max(1, value.length()) > 20) score -= 30;
        if (DATEISH.matcher(value).matches()) score -= 5;
        if (words >= 6 && words <= 22) score += 28;
        if (value.endsWith(".") || value.endsWith("!") || value.endsWith("?") || value.endsWith("»")) score += 10;
        if (containsAny(value.toLowerCase(Locale.ROOT),
                "президент", "делегац", "тривог", "аеропорт", "оплат", "зустріч", "квиток", "рейс")) score += 18;
        if (value.length() > 155) score -= 18;
        return score;
    }

    private static boolean looksLikeArticle(List<String> lines) {
        for (String line : lines) {
            int words = line.trim().isEmpty() ? 0 : line.trim().split("\\s+").length;
            if (words >= 7 && words <= 30 && !looksGarbage(line)) return true;
        }
        return false;
    }

    private static boolean looksGarbage(String line) {
        if (TextUtils.isEmpty(line)) return true;
        int letters = 0;
        int cyr = 0;
        int latin = 0;
        int weird = 0;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (Character.isLetter(c)) {
                letters++;
                if (isCyrillic(c)) cyr++; else latin++;
            } else if (!Character.isDigit(c) && !Character.isWhitespace(c)
                    && ".,!?—–-:;()«»'\"/₴%".indexOf(c) < 0) {
                weird++;
            }
        }
        if (letters < 3) return true;
        if (cyr > 4 && latin > 0 && latin * 100 / letters > 32) return true;
        return weird > Math.max(3, line.length() / 10);
    }

    private static boolean looksMostlyNumeric(String line) {
        int useful = 0;
        int digits = 0;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (Character.isLetterOrDigit(c)) useful++;
            if (Character.isDigit(c)) digits++;
        }
        return useful > 0 && digits * 100 / useful > 60;
    }

    private static boolean isCyrillic(char c) {
        Character.UnicodeBlock block = Character.UnicodeBlock.of(c);
        return block == Character.UnicodeBlock.CYRILLIC
                || block == Character.UnicodeBlock.CYRILLIC_SUPPLEMENTARY
                || block == Character.UnicodeBlock.CYRILLIC_EXTENDED_A
                || block == Character.UnicodeBlock.CYRILLIC_EXTENDED_B;
    }

    private static String cleanSubject(String value) {
        if (value == null) return "";
        String clean = value.replaceAll("^[•·—–|:;\\-\\s]+", "")
                .replaceAll("\\s+", " ").trim();
        return shorten(clean, 126);
    }

    static String stripScheduleDetails(String value) {
        if (value == null) return "";
        String clean = RELATIVE_OFFSET_DETAIL.matcher(value).replaceAll(" ");
        clean = CLOCK_DETAIL.matcher(clean).replaceAll(" ");
        clean = RELATIVE_DATE_DETAIL.matcher(clean).replaceAll(" ");
        clean = WEEKDAY_DETAIL.matcher(clean).replaceAll(" ");
        clean = NUMERIC_DATE_DETAIL.matcher(clean).replaceAll(" ");
        return clean.replaceAll("\\s+([,.;:!?])", "$1")
                .replaceAll("^[•·—–|:;,\\-\\s]+", "")
                .replaceAll("[•·—–|:;,\\-\\s]+$", "")
                .replaceAll("\\s+", " ")
                .trim();
    }

    private static String ukrainianAppointmentGoal(String value) {
        String clean = value;
        String lower = clean.toLowerCase(Locale.ROOT);
        if (lower.startsWith("запис до ")) {
            clean = "прийом до " + clean.substring("запис до ".length());
            lower = clean.toLowerCase(Locale.ROOT);
        }
        if (lower.startsWith("прийом ") || lower.startsWith("запис ")
                || lower.startsWith("зустріч ") || lower.startsWith("візит ")
                || lower.startsWith("бронювання ")) {
            return "Не пропустити " + Character.toLowerCase(clean.charAt(0)) + clean.substring(1);
        }
        return "Не пропустити подію: " + clean;
    }

    private static String naturalGoal(String value, String prefix, String... naturalStarts) {
        String lower = value.toLowerCase(Locale.ROOT);
        for (String start : naturalStarts) {
            if (lower.equals(start) || lower.startsWith(start + " ") || lower.startsWith(start + ":")) {
                return capitalize(value);
            }
        }
        return prefix + ": " + value;
    }

    private static String capitalize(String value) {
        if (value == null || value.isEmpty()) return "";
        return Character.toUpperCase(value.charAt(0)) + value.substring(1);
    }

    private static String fallbackSubject(boolean uk, String sourceType) {
        if (uk) {
            if ("image".equals(sourceType)) return "збережене зображення";
            if ("link".equals(sourceType)) return "збережене посилання";
            return "це нагадування";
        }
        if ("image".equals(sourceType)) return "the saved image";
        if ("link".equals(sourceType)) return "the saved link";
        return "this reminder";
    }

    private static String shorten(String value, int max) {
        if (value == null) return "";
        String clean = value.replaceAll("\\s+", " ").trim();
        return clean.length() <= max ? clean : clean.substring(0, Math.max(1, max - 1)).trim() + "…";
    }

    private static boolean containsAny(String value, String... needles) {
        for (String needle : needles) if (value.contains(needle)) return true;
        return false;
    }
}
