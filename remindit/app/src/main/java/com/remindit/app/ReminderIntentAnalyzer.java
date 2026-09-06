package com.remindit.app;

import android.content.Context;
import android.text.TextUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

public final class ReminderIntentAnalyzer {
    private static final Pattern TIME_ONLY = Pattern.compile("^\\s*\\d{1,2}[:.]\\d{2}\\s*$");
    private static final Pattern STATUS_NOISE = Pattern.compile(
            ".*(\\b4g\\b|\\b5g\\b|volte|wifi|wi-fi|battery|lifecell|kyivstar|vodafone|\\d{1,3}%|мб/с|kb/s).*",
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
        boolean uk = LanguageManager.isUk(context);
        String text = rawText == null ? "" : rawText.trim();
        List<String> lines = usefulLines(text);
        String subject = chooseSubject(lines, text);
        String lower = text.toLowerCase(Locale.ROOT);

        String type = "remember";
        String category = "Personal";
        int confidence = 45;

        if (containsAny(lower,
                "оплат", "сплат", "рахунок", "квитанц", "борг", "грн", "₴",
                "invoice", "bill", "payment", "pay ", "due amount")) {
            type = "payment";
            category = "Bills";
            confidence = 90;
        } else if (containsAny(lower,
                "квиток", "рейс", "поїзд", "автобус", "виліт", "відправлення", "посадка",
                "ticket", "flight", "train", "bus", "departure", "boarding", "gate")) {
            type = "travel";
            category = "Travel";
            confidence = 88;
        } else if (containsAny(lower,
                "купити", "замовити", "ціна", "знижк", "акці", "кошик",
                "buy", "order", "price", "discount", "sale", "cart")) {
            type = "shopping";
            category = "Shopping";
            confidence = 86;
        } else if (containsAny(lower,
                "зателефон", "подзвон", "передзвон", "набрати", "call ", "phone ", "call back")) {
            type = "call";
            category = "Personal";
            confidence = 86;
        } else if (containsAny(lower,
                "відповісти", "написати", "повідомлення", "reply", "respond", "message", "text back")) {
            type = "reply";
            category = "Personal";
            confidence = 84;
        } else if (containsAny(lower,
                "зустріч", "лікар", "прийом", "запис", "бронювання", "візит",
                "meeting", "appointment", "doctor", "reservation", "booking")) {
            type = "appointment";
            category = "Personal";
            confidence = 88;
        } else if (containsAny(lower,
                "дедлайн", "зробити", "виконати", "подати", "здати", "робота", "завдання",
                "deadline", "task", "submit", "work", "finish", "complete")) {
            type = "task";
            category = "Work";
            confidence = 80;
        } else if (containsAny(lower,
                "нагад", "не забуд", "remember", "remind", "don't forget", "dont forget")) {
            type = "remember";
            category = DateDetector.inferCategory(text);
            confidence = 72;
        } else {
            category = DateDetector.inferCategory(text);
        }

        String goal = buildGoal(uk, type, subject);
        String title = buildTitle(uk, type, subject);
        return new Result(title, goal, category, type, confidence);
    }

    public static String intentDisplay(Context context, String type) {
        boolean uk = LanguageManager.isUk(context);
        if ("payment".equals(type)) return uk ? "Оплата" : "Payment";
        if ("travel".equals(type)) return uk ? "Поїздка" : "Travel";
        if ("shopping".equals(type)) return uk ? "Покупка" : "Shopping";
        if ("call".equals(type)) return uk ? "Дзвінок" : "Call";
        if ("reply".equals(type)) return uk ? "Відповідь" : "Reply";
        if ("appointment".equals(type)) return uk ? "Подія" : "Appointment";
        if ("task".equals(type)) return uk ? "Завдання" : "Task";
        return uk ? "Не забути" : "Remember";
    }

    private static String buildGoal(boolean uk, String type, String subject) {
        String shortSubject = shorten(subject, 72);
        if (uk) {
            if ("payment".equals(type)) return "Оплатити: " + shortSubject;
            if ("travel".equals(type)) return "Не пропустити поїздку: " + shortSubject;
            if ("shopping".equals(type)) return "Купити / перевірити: " + shortSubject;
            if ("call".equals(type)) return "Зателефонувати: " + shortSubject;
            if ("reply".equals(type)) return "Відповісти: " + shortSubject;
            if ("appointment".equals(type)) return "Не пропустити подію: " + shortSubject;
            if ("task".equals(type)) return "Виконати: " + shortSubject;
            return "Не забути: " + shortSubject;
        }
        if ("payment".equals(type)) return "Pay: " + shortSubject;
        if ("travel".equals(type)) return "Don't miss the trip: " + shortSubject;
        if ("shopping".equals(type)) return "Buy / check: " + shortSubject;
        if ("call".equals(type)) return "Call: " + shortSubject;
        if ("reply".equals(type)) return "Reply: " + shortSubject;
        if ("appointment".equals(type)) return "Don't miss: " + shortSubject;
        if ("task".equals(type)) return "Do: " + shortSubject;
        return "Remember: " + shortSubject;
    }

    private static String buildTitle(boolean uk, String type, String subject) {
        String subjectShort = shorten(subject, 46);
        String prefix;
        if (uk) {
            if ("payment".equals(type)) prefix = "Оплата";
            else if ("travel".equals(type)) prefix = "Поїздка";
            else if ("shopping".equals(type)) prefix = "Покупка";
            else if ("call".equals(type)) prefix = "Дзвінок";
            else if ("reply".equals(type)) prefix = "Відповісти";
            else if ("appointment".equals(type)) prefix = "Подія";
            else if ("task".equals(type)) prefix = "Завдання";
            else prefix = "Нагадування";
        } else {
            if ("payment".equals(type)) prefix = "Payment";
            else if ("travel".equals(type)) prefix = "Travel";
            else if ("shopping".equals(type)) prefix = "Shopping";
            else if ("call".equals(type)) prefix = "Call";
            else if ("reply".equals(type)) prefix = "Reply";
            else if ("appointment".equals(type)) prefix = "Appointment";
            else if ("task".equals(type)) prefix = "Task";
            else prefix = "Reminder";
        }
        if (TextUtils.isEmpty(subjectShort)) return prefix;
        if (subjectShort.toLowerCase(Locale.ROOT).startsWith(prefix.toLowerCase(Locale.ROOT))) return subjectShort;
        return prefix + " • " + subjectShort;
    }

    private static List<String> usefulLines(String text) {
        ArrayList<String> result = new ArrayList<>();
        if (TextUtils.isEmpty(text)) return result;
        for (String original : text.replace('\r', '\n').split("\\n+")) {
            String line = original.trim().replaceAll("\\s+", " ");
            if (line.length() < 3) continue;
            if (TIME_ONLY.matcher(line).matches()) continue;
            if (STATUS_NOISE.matcher(line).matches()) continue;
            int letters = 0;
            for (int i = 0; i < line.length(); i++) if (Character.isLetter(line.charAt(i))) letters++;
            if (letters < 3) continue;
            result.add(line);
        }
        return result;
    }

    private static String chooseSubject(List<String> lines, String fallback) {
        if (!lines.isEmpty()) {
            String best = lines.get(0);
            int bestScore = scoreLine(best);
            for (String line : lines) {
                int score = scoreLine(line);
                if (score > bestScore) {
                    best = line;
                    bestScore = score;
                }
            }
            return cleanSubject(best);
        }
        if (fallback == null) return "";
        return cleanSubject(fallback.replace('\n', ' ').replaceAll("\\s+", " ").trim());
    }

    private static int scoreLine(String line) {
        String lower = line.toLowerCase(Locale.ROOT);
        int score = Math.min(line.length(), 70);
        if (containsAny(lower, "оплат", "квиток", "зустріч", "купити", "зателефон", "дедлайн",
                "pay", "ticket", "meeting", "buy", "call", "deadline")) score += 50;
        if (line.matches(".*\\d{1,2}[:.]\\d{2}.*")) score += 7;
        if (line.matches(".*\\d{1,2}[./-]\\d{1,2}([./-]\\d{2,4})?.*")) score += 7;
        if (line.length() > 95) score -= 20;
        return score;
    }

    private static String cleanSubject(String value) {
        if (value == null) return "";
        return shorten(value.replaceAll("^[•·—–|:;\\-\\s]+", "").replaceAll("\\s+", " ").trim(), 90);
    }

    private static String shorten(String value, int max) {
        if (value == null) return "";
        String clean = value.replaceAll("\\s+", " ").trim();
        return clean.length() <= max ? clean : clean.substring(0, Math.max(1, max - 1)) + "…";
    }

    private static boolean containsAny(String value, String... needles) {
        for (String needle : needles) if (value.contains(needle)) return true;
        return false;
    }
}
