package com.remindit.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import java.util.ArrayList;
import java.util.List;

public class ReminderDb extends SQLiteOpenHelper {
    private static final String DB_NAME = "remindit.db";
    private static final int DB_VERSION = 2;

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
                        "remind_at INTEGER NOT NULL," +
                        "created_at INTEGER NOT NULL," +
                        "done INTEGER NOT NULL DEFAULT 0" +
                        ")"
        );
        db.execSQL("CREATE INDEX idx_remind_at ON reminders(remind_at)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion < 2) {
            db.execSQL("ALTER TABLE reminders ADD COLUMN goal TEXT");
            db.execSQL("ALTER TABLE reminders ADD COLUMN intent_type TEXT");
        }
    }

    public long insert(Reminder reminder) {
        return getWritableDatabase().insertOrThrow("reminders", null, toValues(reminder));
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
        ArrayList<Reminder> list = new ArrayList<>();
        Cursor cursor = getReadableDatabase().query(
                "reminders", null, "done=0", null, null, null, "remind_at ASC"
        );
        try {
            while (cursor.moveToNext()) list.add(fromCursor(cursor));
        } finally {
            cursor.close();
        }
        return list;
    }

    public List<Reminder> getFuturePending(long now) {
        ArrayList<Reminder> list = new ArrayList<>();
        Cursor cursor = getReadableDatabase().query(
                "reminders", null, "done=0 AND remind_at>?",
                new String[]{String.valueOf(now)}, null, null, "remind_at ASC"
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
        for (Reminder reminder : getFuturePending(now)) {
            ReminderScheduler.schedule(context, reminder);
        }
    }

    public void markDone(long id) {
        ContentValues values = new ContentValues();
        values.put("done", 1);
        getWritableDatabase().update("reminders", values, "id=?", new String[]{String.valueOf(id)});
    }

    public void delete(long id) {
        getWritableDatabase().delete("reminders", "id=?", new String[]{String.valueOf(id)});
    }

    private ContentValues toValues(Reminder reminder) {
        ContentValues values = new ContentValues();
        values.put("title", reminder.title);
        values.put("body", reminder.body);
        values.put("goal", reminder.goal);
        values.put("intent_type", reminder.intentType);
        values.put("category", reminder.category);
        values.put("source_type", reminder.sourceType);
        values.put("image_path", reminder.imagePath);
        values.put("remind_at", reminder.remindAt);
        values.put("created_at", reminder.createdAt);
        values.put("done", reminder.done ? 1 : 0);
        return values;
    }

    private Reminder fromCursor(Cursor cursor) {
        Reminder reminder = new Reminder();
        reminder.id = cursor.getLong(cursor.getColumnIndexOrThrow("id"));
        reminder.title = cursor.getString(cursor.getColumnIndexOrThrow("title"));
        reminder.body = cursor.getString(cursor.getColumnIndexOrThrow("body"));
        int goalIndex = cursor.getColumnIndex("goal");
        reminder.goal = goalIndex >= 0 ? cursor.getString(goalIndex) : null;
        int intentIndex = cursor.getColumnIndex("intent_type");
        reminder.intentType = intentIndex >= 0 ? cursor.getString(intentIndex) : null;
        reminder.category = cursor.getString(cursor.getColumnIndexOrThrow("category"));
        reminder.sourceType = cursor.getString(cursor.getColumnIndexOrThrow("source_type"));
        reminder.imagePath = cursor.getString(cursor.getColumnIndexOrThrow("image_path"));
        reminder.remindAt = cursor.getLong(cursor.getColumnIndexOrThrow("remind_at"));
        reminder.createdAt = cursor.getLong(cursor.getColumnIndexOrThrow("created_at"));
        reminder.done = cursor.getInt(cursor.getColumnIndexOrThrow("done")) == 1;
        return reminder;
    }
}
