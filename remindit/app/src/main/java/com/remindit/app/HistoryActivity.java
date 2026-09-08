package com.remindit.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
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
    private static final int BLUE = UiKit.INDIGO;
    private static final int GREEN = UiKit.GREEN;
    private static final int RED = UiKit.RED;
    private static final int TEXT = UiKit.TEXT;
    private static final int MUTED = UiKit.MUTED;
    private static final int BG = UiKit.BG;
    private static final int BORDER = UiKit.BORDER;

    private LinearLayout list;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        UiKit.applySystemBars(this);
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
        Button back = UiKit.iconButton(this, "‹");
        back.setContentDescription(LanguageManager.pick(this, "Назад", "Back"));
        back.setOnClickListener(v -> finish());
        header.addView(back, new LinearLayout.LayoutParams(dp(48), dp(48)));
        LinearLayout title = new LinearLayout(this);
        title.setOrientation(LinearLayout.VERTICAL);
        title.addView(text(LanguageManager.pick(this, "Історія", "History"), 26, true, TEXT));
        title.addView(text(LanguageManager.pick(this, "Завершене не губиться", "Completed, not lost"), 13, false, MUTED));
        header.addView(title, new LinearLayout.LayoutParams(0, -2, 1f));
        root.addView(header, margin(-1, -2, 0, 0, 0, 12));

        TextView hint = text(LanguageManager.pick(this,
                "✓ Тут зберігаються виконані нагадування. Повернення поставить подію через одну годину.",
                "✓ Completed reminders live here. Restoring schedules the event one hour from now."),
                13, true, GREEN);
        hint.setPadding(dp(14), dp(12), dp(14), dp(12));
        hint.setBackground(UiKit.rounded(this, Color.rgb(240, 253, 244),
                Color.rgb(187, 247, 208), 1, 16));
        root.addView(hint, margin(-1, -2, 0, 0, 0, 16));

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
            TextView icon = text("✓", 40, true, GREEN);
            icon.setGravity(Gravity.CENTER);
            empty.addView(icon);
            TextView label = text(LanguageManager.pick(this,
                    "Історія поки порожня", "History is empty"), 18, true, TEXT);
            label.setGravity(Gravity.CENTER);
            empty.addView(label, margin(-1, -2, 0, 8, 0, 0));
            TextView copy = text(LanguageManager.pick(this,
                    "Виконані справи з’являться тут.", "Completed items will appear here."),
                    13, false, MUTED);
            copy.setGravity(Gravity.CENTER);
            empty.addView(copy, margin(-1, -2, 0, 7, 0, 0));
            list.addView(empty);
            return;
        }

        SimpleDateFormat fmt = new SimpleDateFormat("dd MMM yyyy • HH:mm", LanguageManager.displayLocale(this));
        for (Reminder reminder : history) {
            LinearLayout item = card();
            int categoryColor = UiKit.categoryColor(reminder.category);
            item.setBackground(UiKit.rounded(this, UiKit.SURFACE,
                    androidx.core.graphics.ColorUtils.setAlphaComponent(categoryColor, 52), 1, 22));
            item.addView(UiKit.chip(this,
                    UiKit.categoryIcon(reminder.category) + "  " + UiKit.categoryLabel(this, reminder.category),
                    categoryColor));
            item.addView(text(!TextUtils.isEmpty(reminder.goal) ? reminder.goal : reminder.title,
                    17, true, TEXT), margin(-1, -2, 0, 11, 0, 0));
            long when = reminder.completedAt > 0 ? reminder.completedAt : reminder.remindAt;
            item.addView(text(LanguageManager.pick(this, "Виконано • ", "Completed • ")
                    + fmt.format(new Date(when)), 12, true, MUTED), margin(-1, -2, 0, 7, 0, 10));

            if (reminder.hasImageOriginal() || reminder.hasLinkOriginal()) {
                Button original = UiKit.softButton(this, OriginalActions.actionLabel(this, reminder), UiKit.SKY);
                original.setOnClickListener(v -> OriginalActions.open(this, reminder));
                item.addView(original, margin(-1, dp(46), 0, 0, 0, 8));
            }

            LinearLayout actions = new LinearLayout(this);
            actions.setOrientation(LinearLayout.HORIZONTAL);
            Button restore = UiKit.softButton(this, LanguageManager.pick(this, "↺ Повернути", "↺ Restore"), BLUE);
            restore.setOnClickListener(v -> {
                long next = System.currentTimeMillis() + 60 * 60_000L;
                ReminderDb db = new ReminderDb(this);
                db.restore(reminder.id, next);
                Reminder restored = db.get(reminder.id);
                if (restored != null) ReminderScheduler.schedule(this, restored);
                render();
            });
            Button delete = UiKit.ghostButton(this, LanguageManager.pick(this, "Видалити", "Delete"), RED);
            delete.setOnClickListener(v -> confirmDelete(reminder));
            actions.addView(restore, new LinearLayout.LayoutParams(0, dp(44), 1f));
            actions.addView(new View(this), new LinearLayout.LayoutParams(dp(8), 1));
            actions.addView(delete, new LinearLayout.LayoutParams(0, dp(44), 1f));
            item.addView(actions);
            item.setAlpha(0f);
            item.setTranslationY(dp(10));
            item.animate().alpha(1f).translationY(0f).setDuration(200L).start();
            list.addView(item, margin(-1, -2, 0, 0, 0, 10));
        }
    }

    private void confirmDelete(Reminder reminder) {
        new AlertDialog.Builder(this)
                .setTitle(LanguageManager.pick(this, "Видалити назавжди?", "Delete permanently?"))
                .setMessage(LanguageManager.pick(this,
                        "Нагадування та локальна копія оригінального зображення будуть видалені.",
                        "The reminder and its local original image copy will be deleted."))
                .setNegativeButton(LanguageManager.pick(this, "Скасувати", "Cancel"), null)
                .setPositiveButton(LanguageManager.pick(this, "Видалити", "Delete"), (dialog, which) -> {
                    new ReminderDb(this).delete(reminder.id);
                    render();
                })
                .show();
    }

    private LinearLayout card() {
        return UiKit.card(this);
    }

    private TextView text(String value, int sp, boolean bold, int color) {
        return UiKit.text(this, value, sp, bold, color);
    }

    private LinearLayout.LayoutParams margin(int width, int height, int left, int top, int right, int bottom) {
        return UiKit.margin(this, width, height, left, top, right, bottom);
    }

    private int dp(int value) { return UiKit.dp(this, value); }
}
