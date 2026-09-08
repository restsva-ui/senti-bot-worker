package com.remindit.app;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.Toast;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class SmartActions {
    private static final Pattern PHONE = Pattern.compile(
            "(?<!\\d)(?:\\+?\\d[\\d\\s()\\-]{7,}\\d)(?!\\d)"
    );
    private static final Pattern ADDRESS_HINT = Pattern.compile(
            ".*(вул(?:иця|\\.)?|просп(?:ект|\\.)?|пров(?:улок|\\.)?|площа|шосе|бульвар|" +
                    "street|st\\.|avenue|ave\\.|road|rd\\.|square).*",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );

    private SmartActions() {}

    public static PendingIntent pending(Context context, Reminder reminder, int salt) {
        Intent intent = buildIntent(reminder);
        if (intent == null) return null;
        int code = (int) ((reminder.id ^ (reminder.id >>> 32)) + salt);
        return PendingIntent.getActivity(
                context,
                code,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    public static boolean open(Context context, Reminder reminder) {
        Intent intent = buildIntent(reminder);
        if (context == null || intent == null) return false;
        try {
            if (!(context instanceof Activity)) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            return true;
        } catch (Exception error) {
            Toast.makeText(context,
                    LanguageManager.pick(context, "Не вдалося виконати дію", "Could not open the action"),
                    Toast.LENGTH_SHORT).show();
            return false;
        }
    }

    public static String label(Context context, Reminder reminder) {
        if (reminder != null && "call".equals(reminder.intentType) && phoneNumber(reminder.body) != null) {
            return LanguageManager.pick(context, "Зателефонувати", "Call");
        }
        return LanguageManager.pick(context, "Відкрити маршрут", "Open route");
    }

    public static boolean available(Reminder reminder) {
        return buildIntent(reminder) != null;
    }

    static String phoneNumber(String text) {
        if (text == null) return null;
        Matcher matcher = PHONE.matcher(text);
        while (matcher.find()) {
            String candidate = matcher.group().trim();
            boolean plus = candidate.startsWith("+");
            String digits = candidate.replaceAll("\\D", "");
            if (digits.length() >= 7 && digits.length() <= 15) {
                return plus ? "+" + digits : digits;
            }
        }
        return null;
    }

    static String address(String text) {
        if (text == null) return null;
        for (String raw : text.replace('\r', '\n').split("\\n+")) {
            String line = raw.trim().replaceAll("\\s+", " ");
            if (line.length() >= 6 && line.length() <= 140 && ADDRESS_HINT.matcher(line).matches()) {
                return line;
            }
        }
        return null;
    }

    private static Intent buildIntent(Reminder reminder) {
        if (reminder == null) return null;
        if ("call".equals(reminder.intentType)) {
            String phone = phoneNumber(reminder.body);
            if (phone != null) return new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + phone));
        }
        if ("appointment".equals(reminder.intentType) || "travel".equals(reminder.intentType)) {
            String address = address(reminder.body);
            if (address != null) {
                return new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(address)));
            }
        }
        return null;
    }
}
