package com.remindit.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;

public class HistoryActivity extends Activity {
    private static final int BLUE = Color.rgb(10, 132, 255);
    private static final int GREEN = Color.rgb(22, 163, 74);
    private static final int RED = Color.rgb(220, 38, 38);
    private static final int TEXT = Color.rgb(15, 23, 42);
    private static final int MUTED = Color.rgb(100, 116, 139);
    private static final int BG = Color.rgb(247, 250, 255);
    private static final int BORDER = Color.rgb(226, 232, 240);

    private LinearLayout list;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(Color.WHITE);
        setContentView(buildUi());
    }

    @Override
    protected void onResume() {
        super.onResume();
        render();
    }

    private View buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        final int horizontal = dp(18), top = dp(16), bottom = dp(36);
        root.setPadding(horizontal, top, horizontal, bottom);
        scroll.addView(root);

        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(horizontal, top + bars.top, horizontal, bottom + bars.bottom);
            return insets;
        });

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        Button back = new Button(this);
        back.setText("‹");
        back.setTextSize(30);
        back.setBackgroundColor(Color.TRANSPARENT);
        back.setOnClickListener(v -> finish());
        header.addView(back, new LinearLayout.LayoutParams(dp(52), dp(54)));
        header.addView(text(LanguageManager.pick(this, "Історія", "History"), 26, true, TEXT),
                new LinearLayout.LayoutParams(0, -2, 1f));
        root.addView(header, margin(-1, -2, 0, 0, 0, 12));

        TextView hint = text(LanguageManager.pick(this,
                "Виконані нагадування. Їх можна повернути або видалити.",
                "Completed reminders. You can restore or delete them."), 13, false, MUTED);
        root.addView(hint, margin(-1, -2, 0, 0, 0, 14));

        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        root.addView(list);
        return scroll;
    }

    private void render() {
        if (list == null) return;
        list.removeAllViews();
        List<Reminder> history = new ReminderDb(this).getHistory();
        if (history.isEmpty()) {
            LinearLayout empty = card();
            TextView icon = text("✓", 34, true, GREEN);
            icon.setGravity(Gravity.CENTER);
            empty.addView(icon);
            TextView label = text(LanguageManager.pick(this,
                    "Історія поки порожня", "History is empty"), 18, true, TEXT);
            label.setGravity(Gravity.CENTER);
            empty.addView(label, margin(-1, -2, 0, 8, 0, 0));
            list.addView(empty);
            return;
        }

        SimpleDateFormat fmt = new SimpleDateFormat("dd MMM yyyy • HH:mm", LanguageManager.displayLocale(this));
        for (Reminder reminder : history) {
            LinearLayout item = card();
            item.addView(text(!TextUtils.isEmpty(reminder.goal) ? reminder.goal : reminder.title, 17, true, TEXT));
            long when = reminder.completedAt > 0 ? reminder.completedAt : reminder.remindAt;
            item.addView(text(fmt.format(new Date(when)), 12, true, MUTED), margin(-1, -2, 0, 5, 0, 8));

            if (reminder.hasImageOriginal() || reminder.hasLinkOriginal()) {
                Button original = secondaryButton(OriginalActions.actionLabel(this, reminder));
                original.setOnClickListener(v -> OriginalActions.open(this, reminder));
                item.addView(original, margin(-1, dp(46), 0, 0, 0, 8));
            }

            LinearLayout actions = new LinearLayout(this);
            actions.setOrientation(LinearLayout.HORIZONTAL);
            Button restore = smallButton(LanguageManager.pick(this, "↺ Повернути", "↺ Restore"), BLUE);
            restore.setOnClickListener(v -> {
                long next = System.currentTimeMillis() + 60 * 60_000L;
                ReminderDb db = new ReminderDb(this);
                db.restore(reminder.id, next);
                Reminder restored = db.get(reminder.id);
                if (restored != null) ReminderScheduler.schedule(this, restored);
                render();
            });
            Button delete = smallButton(LanguageManager.pick(this, "Видалити", "Delete"), RED);
            delete.setOnClickListener(v -> {
                new ReminderDb(this).delete(reminder.id);
                render();
            });
            actions.addView(restore, new LinearLayout.LayoutParams(0, dp(44), 1f));
            actions.addView(new View(this), new LinearLayout.LayoutParams(dp(8), 1));
            actions.addView(delete, new LinearLayout.LayoutParams(0, dp(44), 1f));
            item.addView(actions);
            list.addView(item, margin(-1, -2, 0, 0, 0, 10));
        }
    }

    private LinearLayout card() {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setPadding(dp(16), dp(16), dp(16), dp(16));
        c.setBackground(rounded(Color.WHITE, BORDER, 1, 18));
        return c;
    }

    private Button secondaryButton(String label) {
        Button b = baseButton(label);
        b.setTextColor(BLUE);
        b.setBackground(rounded(Color.WHITE, BLUE, 1, 14));
        return b;
    }

    private Button smallButton(String label, int color) {
        Button b = baseButton(label);
        b.setTextColor(color);
        b.setTextSize(13);
        b.setBackground(rounded(Color.WHITE, color, 1, 13));
        return b;
    }

    private Button baseButton(String label) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(14);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        return b;
    }

    private TextView text(String value, int sp, boolean bold, int color) {
        TextView v = new TextView(this);
        v.setText(value);
        v.setTextSize(sp);
        v.setTextColor(color);
        if (bold) v.setTypeface(Typeface.DEFAULT_BOLD);
        return v;
    }

    private GradientDrawable rounded(int fill, int stroke, int width, int radius) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(fill);
        d.setCornerRadius(dp(radius));
        d.setStroke(dp(width), stroke);
        return d;
    }

    private LinearLayout.LayoutParams margin(int width, int height, int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(width, height);
        p.setMargins(dp(left), dp(top), dp(right), dp(bottom));
        return p;
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
