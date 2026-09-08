package com.remindit.app;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.Toast;

public final class OriginalActions {
    private OriginalActions() {}

    public static boolean open(Context context, Reminder reminder) {
        if (context == null || reminder == null) return false;
        try {
            Intent intent = buildIntent(context, reminder);
            if (intent == null) return false;
            if (!(context instanceof android.app.Activity)) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            return true;
        } catch (Exception e) {
            Toast.makeText(context,
                    LanguageManager.pick(context, "Не вдалося відкрити оригінал", "Could not open original"),
                    Toast.LENGTH_SHORT).show();
            return false;
        }
    }

    public static PendingIntent pending(Context context, Reminder reminder, int salt) {
        Intent intent = buildIntent(context, reminder);
        if (intent == null) return null;
        int code = (int) ((reminder.id ^ (reminder.id >>> 32)) + salt);
        return PendingIntent.getActivity(
                context,
                code,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static Intent buildIntent(Context context, Reminder reminder) {
        if (reminder.hasImageOriginal()) {
            Intent intent = new Intent(context, OriginalViewerActivity.class);
            intent.putExtra("image_path", reminder.imagePath);
            return intent;
        }
        if (reminder.hasLinkOriginal()) {
            return new Intent(Intent.ACTION_VIEW, Uri.parse(reminder.sourceUri));
        }
        return null;
    }

    public static String actionLabel(Context context, Reminder reminder) {
        if (reminder == null) return LanguageManager.pick(context, "Оригінал", "Original");
        if (reminder.hasImageOriginal()) {
            return LanguageManager.pick(context, "Переглянути фото", "View image");
        }
        if (reminder.hasLinkOriginal()) {
            return LanguageManager.pick(context, "Перейти за посиланням", "Open link");
        }
        return LanguageManager.pick(context, "Оригінал", "Original");
    }
}
