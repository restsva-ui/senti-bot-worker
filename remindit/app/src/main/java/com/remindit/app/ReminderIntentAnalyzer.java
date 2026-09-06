package com.remindit.app;

import android.content.Context;
import android.text.TextUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class ReminderIntentAnalyzer {
    private static final Pattern TIME_ONLY = Pattern.compile("^\\s*\\d{1,2}[:.]\\d{2}\\s*$");
    private static final Pattern TIME_ANYWHERE = Pattern.compile("\\b\\d{1,2}[:.]\\d{2}\\b");
    private static final Pattern STATUS_NOISE = Pattern.compile(
            ".*(\\b4g\\b|\\b5g\\b|volte|wifi|wi-fi|battery|lifecell|kyivstar|vodafone|\\d{1,3}%|мб/с|kb/s).*",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );
    private static final Pattern UI_NOISE = Pattern.compile(
            ".*(підписник|підписат|прикріплене повідомлення|сповіщати|перегляд|telegram|whatsapp|reactions|написати повідомлення).*",
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
        String text = rawText == null ? "" : rawText.trim();
        List<String> lines = usefulLines(text);
        String subject = chooseSubject(lines, text);
        String lower = text.toLowerCase(Locale.ROOT);

        String type = "remember";
        String category = "Personal";
        int confidence = 50;

        boolean channelLike = containsAny(lower,
                "підписник", "підписат", "прикріплене повідомлення", "переглядів", "канал");
        boolean chatLike = !channelLike && countTimes(text) >= 2;

        if (containsAny(lower,
                "оплат", "сплат", "рахунок", "квитанц", "борг", "грн", "₴",
                "invoice", "bill", "payment", "pay ", "due amount")) {
            type = "payment";
            category = "Bills";
            confidence = 92;
        } else if (containsAny(lower,
                "квиток", "рейс", "поїзд", "автобус", "виліт", "відправлення", "посадка",
                "ticket", "flight", "train", "bus", "departure", "boarding", "gate")) {
            type = "travel";
            category = "Travel";
            confidence = 90;
        } else if (containsAny(lower,
                "купити", "замовити", "ціна", "знижк", "акці", "кошик",
                "buy", "order", "price", "discount", "sale", "cart")) {
            type = "shopping";
            category = "Shopping";
            confidence = 88;
        } else if (containsAny(lower,
                "зателефон", "подзвон", "передзвон", "набрати", "call ", "phone ", "call back")) {
            type = "call";
            category = "Personal";
            confidence = 88;
        } else if (containsAny(lower,
                "відповісти", "відписати", "відповідь на", "написати у відповідь", "reply", "respond", "text back")) {
            type = "reply";
            category = "Personal";
            confidence = 90;
        } else if (containsAny(lower,
                "зустріч", "лікар", "прийом", "запис", "бронювання", "візит",
                "meeting", "appointment", "doctor", "reservation", "booking")) {
            type = "appointment";
            category = "Personal";
            confidence = 90;
        } else if (containsAny(lower,
                "дедлайн", "зробити", "виконати", "подати", "здати", "робота", "завдання",
                "deadline", "task", "submit", "work", "finish", "complete")) {
            type = "task";
            category = "Work";
            confidence = 84;
        } else if ("image".equals(sourceType) && chatLike) {
            type = "reply";
            category = "Personal";
            confidence = 72;
        } else if ("image".equals(sourceType) || channelLike || text.length() > 120) {
            type = "review";
            category = "Other";
            confidence = 70;
        } else if (containsAny(lower,
                "нагад", "не забуд", "remember", "remind", "don't forget", "dont forget")) {
            type = "remember";
            category = DateDetector.inferCategory(text);
            confidence = 74;
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
        if ("reply".equals(type)) return uk ? "Відповісти" : "Reply";
        if ("appointment".equals(type)) return uk ? "Подія" : "Appointment";
        if ("task".equals(type)) return uk ? "Завдання" : "Task";
        if ("review".equals(type)) return uk ? "Переглянути" : "Review";
        return uk ? "Не забути" : "Remember";
    }

    private static String buildGoal(boolean uk, String type, String subject) {
        String shortSubject = shorten(subject, 92);
        if (uk) {
            if ("payment".equals(type)) return "Оплатити: " + shortSubject;
            if ("travel".equals(type)) return "Не пропустити: " + shortSubject;
            if ("shopping".equals(type)) return "Перевірити або купити: " + shortSubject;
            if ("call".equals(type)) return "Зателефонувати: " + shortSubject;
            if ("reply".equals(type)) return "Відповісти: " + shortSubject;
            if ("appointment".equals(type)) return "Не пропустити: " + shortSubject;
            if ("task".equals(type)) return "Виконати: " + shortSubject;
            if ("review".equals(type)) return "Переглянути: " + shortSubject;
            return "Не забути про: " + shortSubject;
        }
        if ("payment".equals(type)) return "Pay: " + shortSubject;
        if ("travel".equals(type)) return "Don't miss: " + shortSubject;
        if ("shopping".equals(type)) return "Check or buy: " + shortSubject;
        if ("call".equals(type)) return "Call: " + shortSubject;
        if ("reply".equals(type)) return "Reply: " + shortSubject;
        if ("appointment".equals(type)) return "Don't miss: " + shortSubject;
        if ("task".equals(type)) return "Do: " + shortSubject;
        if ("review".equals(type)) return "Review: " + shortSubject;
        return "Remember: " + shortSubject;
    }

    private static String buildTitle(boolean uk, String type, String subject) {
        String subjectShort = shorten(subject, 58);
        if (!TextUtils.isEmpty(subjectShort)) return subjectShort;
        if (uk) {
            if ("payment".equals(type)) return "Оплата";
            if ("travel".equals(type)) return "Поїздка";
            if ("shopping".equals(type)) return "Покупка";
            if ("call".equals(type)) return "Дзвінок";
            if ("reply".equals(type)) return "Відповісти";
            if ("appointment".equals(type)) return "Подія";
            if ("task".equals(type)) return "Завдання";
            if ("review".equals(type)) return "Переглянути матеріал";
            return "Нагадування";
        }
        if ("payment".equals(type)) return "Payment";
        if ("travel".equals(type)) return "Travel";
        if ("shopping".equals(type)) return "Shopping";
        if ("call".equals(type)) return "Call";
        if ("reply".equals(type)) return "Reply";
        if ("appointment".equals(type)) return "Appointment";
        if ("task".equals(type)) return "Task";
        if ("review".equals(type)) return "Review material";
        return "Reminder";
    }

    private static List<String> usefulLines(String text) {
        ArrayList<String> result = new ArrayList<>();
        if (TextUtils.isEmpty(text)) return result;
        for (String original : text.replace('\r', '\n').split("\\n+")) {
            String line = original.trim().replaceAll("\\s+", " ");
            if (line.length() < 3) continue;
            if (TIME_ONLY.matcher(line).matches()) continue;
            if (STATUS_NOISE.matcher(line).matches()) continue;
            if (UI_NOISE.matcher(line).matches()) continue;
            if (looksMostlyNumeric(line)) continue;
            int letters = 0;
            for (int i = 0; i < line.length(); i++) if (Character.isLetter(line.charAt(i))) letters++;
            if (letters < 3) continue;
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
                    if (combined.length() > 180) break;
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
        return cleanSubject(fallback.replace('\n', ' ').replaceAll("\\s+", " ").trim());
    }

    private static int scoreCandidate(String value) {
        String lower = value.toLowerCase(Locale.ROOT);
        if (UI_NOISE.matcher(value).matches() || STATUS_NOISE.matcher(value).matches()) return -200;
        int letters = 0;
        int words = 0;
        boolean inWord = false;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (Character.isLetter(c)) letters++;
            if (Character.isLetterOrDigit(c)) {
                if (!inWord) words++;
                inWord = true;
            } else {
                inWord = false;
            }
        }
        int score = Math.min(letters, 90) + Math.min(words * 3, 30);
        if (containsAny(lower,
                "оплат", "квиток", "зустріч", "купити", "зателефон", "дедлайн", "делегаці", "президент",
                "pay", "ticket", "meeting", "buy", "call", "deadline")) score += 28;
        if (value.endsWith(".") || value.endsWith("!") || value.endsWith("?") || value.endsWith("»")) score += 8;
        if (value.length() < 18) score -= 20;
        if (value.length() > 155) score -= 10;
        return score;
    }

    private static int countTimes(String text) {
        Matcher matcher = TIME_ANYWHERE.matcher(text == null ? "" : text);
        int count = 0;
        while (matcher.find() && count < 4) count++;
        return count;
    }

    private static boolean looksMostlyNumeric(String line) {
        int useful = 0;
        int digits = 0;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (Character.isLetterOrDigit(c)) useful++;
            if (Character.isDigit(c)) digits++;
        }
        return useful > 0 && digits * 100 / useful > 70;
    }

    private static String cleanSubject(String value) {
        if (value == null) return "";
        String clean = value
                .replaceAll("^[•·—–|:;\\-\\s]+", "")
                .replaceAll("\\s+", " ")
                .trim();
        return shorten(clean, 120);
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
