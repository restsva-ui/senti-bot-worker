package com.remindit.app;

import android.content.Context;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class DetectedFacts {
    private static final Pattern AMOUNT = Pattern.compile(
            "(?i)(?:\\b\\d[\\d ,.]{0,12}\\s?(?:грн|uah|usd|eur)\\b|[₴$€]\\s?\\d[\\d ,.]{0,12})"
    );

    private DetectedFacts() {}

    public static String summary(Context context, String text) {
        List<String> facts = new ArrayList<>();
        long when = DateDetector.detect(text);
        if (when > System.currentTimeMillis()) {
            String formatted = new SimpleDateFormat("dd.MM • HH:mm", LanguageManager.displayLocale(context))
                    .format(new Date(when));
            facts.add(LanguageManager.pick(context, "час " + formatted, "time " + formatted));
        }

        String phone = SmartActions.phoneNumber(text);
        if (phone != null) facts.add(LanguageManager.pick(context, "тел. " + phone, "phone " + phone));

        String address = SmartActions.address(text);
        if (address != null) facts.add(LanguageManager.pick(context, "адреса: " + address, "address: " + address));

        Matcher amount = AMOUNT.matcher(text == null ? "" : text);
        if (amount.find()) facts.add(LanguageManager.pick(context, "сума " + amount.group().trim(), "amount " + amount.group().trim()));

        if (facts.isEmpty()) return "";
        StringBuilder out = new StringBuilder(LanguageManager.pick(context, "Знайдено: ", "Detected: "));
        for (int i = 0; i < facts.size(); i++) {
            if (i > 0) out.append(" • ");
            out.append(facts.get(i));
        }
        return out.toString();
    }
}
