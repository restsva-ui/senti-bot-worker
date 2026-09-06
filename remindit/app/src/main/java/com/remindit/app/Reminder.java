package com.remindit.app;

public class Reminder {
    public long id;
    public String title;
    public String body;
    public String goal;
    public String intentType;
    public String category;
    public String sourceType;
    public String imagePath;
    public String sourceUri;
    public long remindAt;
    public long createdAt;
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
}
