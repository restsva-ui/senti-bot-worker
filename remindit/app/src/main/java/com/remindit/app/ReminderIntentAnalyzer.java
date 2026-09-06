package com.remindit.app;

import android.content.Context;
import android.text.TextUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

public final class ReminderIntentAnalyzer {
    private static final Pattern TIME_ONLY = Pattern.compile("^\\s*\\d{1,2}[:.]\\d{2}\\s*$");
    private static final Pattern STATUS_NOISE = Pattern.compile(".*(\\b4g\\b|\\b5g\\b|volte|wifi|wi-fi|battery|lifecell|kyivstar|vodafone|\\d{1,3}%|мб/с|kb/s).*", Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private static final Pattern UI_NOISE = Pattern.compile(".*(підписник|підписат|прикріплене повідомлення|сповіщати|сповіщення|переглядів|реакці|telegram|whatsapp|канал|написати повідомлення).*", Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private static final Pattern LEADING_TIME = Pattern.compile("^\\s*\\d{1,2}[:.]\\d{2}\\s*");

    public static final class Result {
        public final String title;
        public final String goal;
        public final String categoryKey;
        public final String intentType;
        public final int confidence;
        Result(String title, String goal, String categoryKey, String intentType, int confidence) {
            this.title = title; this.goal = goal; this.categoryKey = categoryKey; this.intentType = intentType; this.confidence = confidence;
        }
    }

    private ReminderIntentAnalyzer() {}
    public static Result analyze(Context context, String rawText) { return analyze(context, rawText, "manual"); }

    public static Result analyze(Context context, String rawText, String sourceType) {
        boolean uk = LanguageManager.isUk(context);
        String text = rawText == null ? "" : rawText.trim();
        String lower = text.toLowerCase(Locale.ROOT);
        String type = "remember";
        String category = DateDetector.inferCategory(text);
        int confidence = 62;

        if (containsAny(lower,"оплат","сплат","рахунок","квитанц","борг","грн","₴","invoice","bill","payment","pay ","due amount")) { type="payment"; category="Bills"; confidence=94; }
        else if (containsAny(lower,"квиток","рейс","поїзд","автобус","виліт","відправлення","посадка","ticket","flight","train","bus","departure","boarding","gate")) { type="travel"; category="Travel"; confidence=92; }
        else if (containsAny(lower,"купити","замовити","ціна","знижк","акці","кошик","buy","order","price","discount","sale","cart")) { type="shopping"; category="Shopping"; confidence=90; }
        else if (containsAny(lower,"зателефон","подзвон","передзвон","набрати","call ","phone ","call back")) { type="call"; category="Personal"; confidence=90; }
        else if (containsAny(lower,"відповісти","відписати","написати у відповідь","reply","respond","text back")) { type="reply"; category="Personal"; confidence=92; }
        else if (containsAny(lower,"зустріч","лікар","прийом","запис","бронювання","візит","meeting","appointment","doctor","reservation","booking")) { type="appointment"; category="Personal"; confidence=92; }
        else if (containsAny(lower,"дедлайн","зробити","виконати","подати","здати","завдання","deadline","task","submit","finish","complete")) { type="task"; category="Work"; confidence=88; }
        else if ("image".equals(sourceType) || text.length() > 120) { type="review"; category="Other"; confidence=78; }

        List<String> lines = usefulLines(text, uk);
        String subject = chooseSubject(lines, text, uk);
        String summary = buildSummary(uk, type, subject);
        return new Result(summary, summary, category, type, confidence);
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

    private static String buildSummary(boolean uk, String type, String subject) {
        String s = shorten(subject, 92);
        if (TextUtils.isEmpty(s)) return uk ? "Не забути" : "Remember";
        if (uk) {
            if ("payment".equals(type)) return "Оплатити: " + s;
            if ("travel".equals(type)) return "Не пропустити: " + s;
            if ("shopping".equals(type)) return "Перевірити або купити: " + s;
            if ("call".equals(type)) return "Зателефонувати: " + s;
            if ("reply".equals(type)) return "Відповісти: " + s;
            if ("appointment".equals(type)) return "Не пропустити: " + s;
            if ("task".equals(type)) return "Виконати: " + s;
            if ("review".equals(type)) return "Переглянути: " + s;
            return "Не забути: " + s;
        }
        if ("payment".equals(type)) return "Pay: " + s;
        if ("travel".equals(type)) return "Don't miss: " + s;
        if ("shopping".equals(type)) return "Check or buy: " + s;
        if ("call".equals(type)) return "Call: " + s;
        if ("reply".equals(type)) return "Reply: " + s;
        if ("appointment".equals(type)) return "Don't miss: " + s;
        if ("task".equals(type)) return "Do: " + s;
        if ("review".equals(type)) return "Review: " + s;
        return "Remember: " + s;
    }

    private static List<String> usefulLines(String text, boolean uk) {
        ArrayList<String> result = new ArrayList<>();
        if (TextUtils.isEmpty(text)) return result;
        for (String original : text.replace('\r','\n').split("\\n+")) {
            String line = LEADING_TIME.matcher(original).replaceFirst("").trim().replaceAll("\\s+"," ");
            if (line.length() < 5 || TIME_ONLY.matcher(line).matches() || STATUS_NOISE.matcher(line).matches() || UI_NOISE.matcher(line).matches() || looksMostlyNumeric(line)) continue;
            if (uk && line.length() > 15 && cyrillicRatio(line) < 0.28) continue;
            int letters=0; for(int i=0;i<line.length();i++) if(Character.isLetter(line.charAt(i))) letters++;
            if(letters<4) continue;
            result.add(line);
        }
        return result;
    }

    private static String chooseSubject(List<String> lines, String fallback, boolean uk) {
        if (!lines.isEmpty()) {
            String best=""; int bestScore=Integer.MIN_VALUE;
            for(int i=0;i<lines.size();i++) {
                String candidate=lines.get(i); int score=scoreCandidate(candidate,uk); if(score>bestScore){best=candidate;bestScore=score;}
                if(i+1<lines.size()) { String combined=candidate+" "+lines.get(i+1); if(combined.length()<=170){int cs=scoreCandidate(combined,uk)+8;if(cs>bestScore){best=combined;bestScore=cs;}} }
            }
            return cleanSubject(best);
        }
        if(fallback==null)return"";
        return cleanSubject(fallback.replace('\n',' ').replaceAll("\\s+"," "));
    }

    private static int scoreCandidate(String value, boolean uk) {
        String lower=value.toLowerCase(Locale.ROOT); int letters=0,words=0; boolean inWord=false;
        for(int i=0;i<value.length();i++){char c=value.charAt(i);if(Character.isLetter(c))letters++;if(Character.isLetterOrDigit(c)){if(!inWord)words++;inWord=true;}else inWord=false;}
        int score=Math.min(letters,100)+Math.min(words*3,36); if(uk)score+=(int)(cyrillicRatio(value)*40);
        if(containsAny(lower,"оплат","квиток","зустріч","купити","зателефон","дедлайн","росі","американ","делегаці","президент","літак","pay","ticket","meeting","buy","call","deadline"))score+=25;
        if(value.length()<18)score-=20; if(value.length()>150)score-=8; return score;
    }

    private static double cyrillicRatio(String line) {
        int letters=0,cyr=0; for(int i=0;i<line.length();i++){char c=line.charAt(i);if(!Character.isLetter(c))continue;letters++;Character.UnicodeBlock b=Character.UnicodeBlock.of(c);if(b==Character.UnicodeBlock.CYRILLIC||b==Character.UnicodeBlock.CYRILLIC_SUPPLEMENTARY)cyr++;} return letters==0?0.0:(double)cyr/letters;
    }
    private static boolean looksMostlyNumeric(String line){int useful=0,digits=0;for(int i=0;i<line.length();i++){char c=line.charAt(i);if(Character.isLetterOrDigit(c))useful++;if(Character.isDigit(c))digits++;}return useful>0&&digits*100/useful>55;}
    private static String cleanSubject(String value){if(value==null)return"";String clean=LEADING_TIME.matcher(value).replaceFirst("").replaceAll("^[•·—–|:;\\-\\s]+","").replaceAll("\\s+"," ").trim();return shorten(clean,120);}
    private static String shorten(String value,int max){if(value==null)return"";String clean=value.replaceAll("\\s+"," ").trim();return clean.length()<=max?clean:clean.substring(0,Math.max(1,max-1))+"…";}
    private static boolean containsAny(String value,String... needles){for(String needle:needles)if(value.contains(needle))return true;return false;}
}
