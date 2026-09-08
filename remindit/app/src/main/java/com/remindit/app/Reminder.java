package com.remindit.app;

public class Reminder {
    public static final String REPEAT_ONCE = "once";
    public static final String REPEAT_DAILY = "daily";
    public static final String REPEAT_WEEKDAYS = "weekdays";
    public static final String REPEAT_WEEKLY = "weekly";

    public long id;
    public String title;
    public String body;
    public String goal;
    public String intentType;
    public String category;
    public String sourceType;
    public String imagePath;
    public String sourceUri;
    public String repeatMode = REPEAT_ONCE;
    public int leadMinutes;
    public int secondLeadMinutes = -1;
    public int followUpMinutes;
    public long snoozeAt;
    public long remindAt;
    public long createdAt;
    public long completedAt;
    public boolean done;

    public Reminder() {}

    public boolean hasImageOriginal() {
        return imagePath != null && !imagePath.trim().isEmpty();
    }

    public boolean hasLinkOriginal() {
        return sourceUri != null && (sourceUri.startsWith("http://") || sourceUri.startsWith("https://"));
    }

    public boolean hasOriginal() {
        return hasImageOriginal() || hasLinkOriginal() || (body != null && !body.trim().isEmpty());
    }

    public boolean isRepeating() {
        return repeatMode != null && !REPEAT_ONCE.equals(repeatMode);
    }
}
