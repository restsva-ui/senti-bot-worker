package com.remindit.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class ReminderDb extends SQLiteOpenHelper {
    private static final String DB_NAME = "remindit.db";
    private static final int DB_VERSION = 6;

    public ReminderDb(Context context) {
        super(context, DB_NAME, null, DB_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL(
                "CREATE TABLE reminders (" +
                        "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                        "title TEXT NOT NULL," +
                        "body TEXT," +
                        "goal TEXT," +
                        "intent_type TEXT," +
                        "category TEXT," +
                        "source_type TEXT," +
                        "image_path TEXT," +
                        "source_uri TEXT," +
                        "repeat_mode TEXT NOT NULL DEFAULT 'once'," +
                        "lead_minutes INTEGER NOT NULL DEFAULT 0," +
                        "second_lead_minutes INTEGER NOT NULL DEFAULT -1," +
                        "follow_up_minutes INTEGER NOT NULL DEFAULT 0," +
                        "snooze_at INTEGER NOT NULL DEFAULT 0," +
                        "remind_at INTEGER NOT NULL," +
                        "created_at INTEGER NOT NULL," +
                        "completed_at INTEGER NOT NULL DEFAULT 0," +
                        "done INTEGER NOT NULL DEFAULT 0" +
                        ")"
        );
        db.execSQL("CREATE INDEX idx_remind_at ON reminders(remind_at)");
        db.execSQL("CREATE INDEX idx_done ON reminders(done)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion < 2) {
            db.execSQL("ALTER TABLE reminders ADD COLUMN goal TEXT");
            db.execSQL("ALTER TABLE reminders ADD COLUMN intent_type TEXT");
        }
        if (oldVersion < 3) {
            db.execSQL("ALTER TABLE reminders ADD COLUMN source_uri TEXT");
        }
        if (oldVersion < 4) {
            db.execSQL("ALTER TABLE reminders ADD COLUMN repeat_mode TEXT NOT NULL DEFAULT 'once'");
            db.execSQL("ALTER TABLE reminders ADD COLUMN completed_at INTEGER NOT NULL DEFAULT 0");
        }
        if (oldVersion < 5) {
            db.execSQL("ALTER TABLE reminders ADD COLUMN lead_minutes INTEGER NOT NULL DEFAULT 0");
            db.execSQL("ALTER TABLE reminders ADD COLUMN second_lead_minutes INTEGER NOT NULL DEFAULT -1");
            db.execSQL("ALTER TABLE reminders ADD COLUMN follow_up_minutes INTEGER NOT NULL DEFAULT 0");
        }
        if (oldVersion < 6) {
            db.execSQL("ALTER TABLE reminders ADD COLUMN snooze_at INTEGER NOT NULL DEFAULT 0");
        }
    }

    public long insert(Reminder reminder) {
        return getWritableDatabase().insertOrThrow("reminders", null, toValues(reminder));
    }

    public void update(Reminder reminder) {
        getWritableDatabase().update(
                "reminders", toValues(reminder), "id=?", new String[]{String.valueOf(reminder.id)}
        );
    }

    public Reminder get(long id) {
        Cursor cursor = getReadableDatabase().query(
                "reminders", null, "id=?", new String[]{String.valueOf(id)},
                null, null, null
        );
        try {
            return cursor.moveToFirst() ? fromCursor(cursor) : null;
        } finally {
            cursor.close();
        }
    }

    public List<Reminder> getUpcoming() {
        return query("done=0", null, "remind_at ASC");
    }

    public List<Reminder> getHistory() {
        return query("done=1", null, "completed_at DESC, remind_at DESC");
    }

    public Reminder findActiveDuplicate(Reminder candidate) {
        if (candidate == null) return null;
        String wantedUrl = clean(candidate.sourceUri);
        String wantedBody = duplicateText(candidate.body);
        for (Reminder existing : getUpcoming()) {
            if (!wantedUrl.isEmpty() && wantedUrl.equalsIgnoreCase(clean(existing.sourceUri))) return existing;
            if (wantedBody.length() >= 12 && wantedBody.equals(duplicateText(existing.body))) return existing;
        }
        return null;
    }

    private List<Reminder> query(String selection, String[] args, String order) {
        ArrayList<Reminder> list = new ArrayList<>();
        Cursor cursor = getReadableDatabase().query(
                "reminders", null, selection, args, null, null, order
        );
        try {
            while (cursor.moveToNext()) list.add(fromCursor(cursor));
        } finally {
            cursor.close();
        }
        return list;
    }

    public void rescheduleFuture(Context context) {
        if (!ReminderScheduler.canScheduleExactly(context)) return;
        long now = System.currentTimeMillis();
        for (Reminder reminder : getUpcoming()) {
            if (reminder.isRepeating() && reminder.remindAt <= now) {
                long next = ReminderScheduler.nextOccurrence(reminder, now);
                if (next <= 0L) continue;
                reminder.remindAt = next;
                reminder.snoozeAt = 0L;
                update(reminder);
            }
            ReminderScheduler.schedule(context, reminder);
        }
    }

    public void markDone(long id) {
        ContentValues values = new ContentValues();
        values.put("done", 1);
        values.put("completed_at", System.currentTimeMillis());
        values.put("snooze_at", 0);
        getWritableDatabase().update("reminders", values, "id=?", new String[]{String.valueOf(id)});
    }

    public void restore(long id, long remindAt) {
        ContentValues values = new ContentValues();
        values.put("done", 0);
        values.put("completed_at", 0);
        values.put("remind_at", remindAt);
        values.put("snooze_at", 0);
        getWritableDatabase().update("reminders", values, "id=?", new String[]{String.valueOf(id)});
    }

    public void updateTiming(long id, long remindAt) {
        ContentValues values = new ContentValues();
        values.put("remind_at", remindAt);
        values.put("done", 0);
        values.put("completed_at", 0);
        values.put("snooze_at", 0);
        getWritableDatabase().update("reminders", values, "id=?", new String[]{String.valueOf(id)});
    }

    public void delete(long id) {
        Reminder reminder = get(id);
        getWritableDatabase().delete("reminders", "id=?", new String[]{String.valueOf(id)});
        if (reminder != null && reminder.imagePath != null) {
            try {
                File file = new File(reminder.imagePath);
                if (file.exists()) file.delete();
            } catch (Exception ignored) {}
        }
    }

    private ContentValues toValues(Reminder reminder) {
        ContentValues values = new ContentValues();
        values.put("title", reminder.title == null ? "RemindIt" : reminder.title);
        values.put("body", reminder.body);
        values.put("goal", reminder.goal);
        values.put("intent_type", reminder.intentType);
        values.put("category", reminder.category);
        values.put("source_type", reminder.sourceType);
        values.put("image_path", reminder.imagePath);
        values.put("source_uri", reminder.sourceUri);
        values.put("repeat_mode", reminder.repeatMode == null ? Reminder.REPEAT_ONCE : reminder.repeatMode);
        values.put("lead_minutes", reminder.leadMinutes);
        values.put("second_lead_minutes", reminder.secondLeadMinutes);
        values.put("follow_up_minutes", reminder.followUpMinutes);
        values.put("snooze_at", reminder.snoozeAt);
        values.put("remind_at", reminder.remindAt);
        values.put("created_at", reminder.createdAt);
        values.put("completed_at", reminder.completedAt);
        values.put("done", reminder.done ? 1 : 0);
        return values;
    }

    private Reminder fromCursor(Cursor cursor) {
        Reminder reminder = new Reminder();
        reminder.id = cursor.getLong(cursor.getColumnIndexOrThrow("id"));
        reminder.title = cursor.getString(cursor.getColumnIndexOrThrow("title"));
        reminder.body = cursor.getString(cursor.getColumnIndexOrThrow("body"));
        reminder.goal = cursor.getString(cursor.getColumnIndexOrThrow("goal"));
        reminder.intentType = cursor.getString(cursor.getColumnIndexOrThrow("intent_type"));
        reminder.category = cursor.getString(cursor.getColumnIndexOrThrow("category"));
        reminder.sourceType = cursor.getString(cursor.getColumnIndexOrThrow("source_type"));
        reminder.imagePath = cursor.getString(cursor.getColumnIndexOrThrow("image_path"));
        reminder.sourceUri = cursor.getString(cursor.getColumnIndexOrThrow("source_uri"));
        int repeatIndex = cursor.getColumnIndex("repeat_mode");
        reminder.repeatMode = repeatIndex >= 0 ? cursor.getString(repeatIndex) : Reminder.REPEAT_ONCE;
        int leadIndex = cursor.getColumnIndex("lead_minutes");
        reminder.leadMinutes = leadIndex >= 0 ? cursor.getInt(leadIndex) : 0;
        int secondLeadIndex = cursor.getColumnIndex("second_lead_minutes");
        reminder.secondLeadMinutes = secondLeadIndex >= 0 ? cursor.getInt(secondLeadIndex) : -1;
        int followUpIndex = cursor.getColumnIndex("follow_up_minutes");
        reminder.followUpMinutes = followUpIndex >= 0 ? cursor.getInt(followUpIndex) : 0;
        int snoozeIndex = cursor.getColumnIndex("snooze_at");
        reminder.snoozeAt = snoozeIndex >= 0 ? cursor.getLong(snoozeIndex) : 0L;
        reminder.remindAt = cursor.getLong(cursor.getColumnIndexOrThrow("remind_at"));
        reminder.createdAt = cursor.getLong(cursor.getColumnIndexOrThrow("created_at"));
        int completedIndex = cursor.getColumnIndex("completed_at");
        reminder.completedAt = completedIndex >= 0 ? cursor.getLong(completedIndex) : 0L;
        reminder.done = cursor.getInt(cursor.getColumnIndexOrThrow("done")) == 1;
        return reminder;
    }

    private String duplicateText(String value) {
        return clean(value).toLowerCase(Locale.ROOT).replaceAll("\\s+", " ");
    }

    private String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
