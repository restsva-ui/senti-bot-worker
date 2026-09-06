package com.remindit.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final int BLUE = Color.rgb(10, 132, 255);
    private static final int BLUE_DARK = Color.rgb(6, 105, 216);
    private static final int TEXT = Color.rgb(15, 23, 42);
    private static final int MUTED = Color.rgb(100, 116, 139);
    private static final int BG = Color.rgb(247, 250, 255);
    private static final int BORDER = Color.rgb(226, 232, 240);
    private static final int GREEN = Color.rgb(22, 163, 74);
    private static final int RED = Color.rgb(220, 38, 38);

    private LinearLayout reminderList;
    private EditText searchInput;
    private Spinner filterSpinner;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(Color.WHITE);
        setContentView(buildUi());
        requestNotificationPermission();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (ReminderScheduler.canScheduleExactly(this)) {
            new ReminderDb(this).rescheduleFuture(this);
        }
        renderReminders();
    }

    private View buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        final int horizontal = dp(18);
        final int normalTop = dp(18);
        final int normalBottom = dp(36);
        root.setPadding(horizontal, normalTop, horizontal, normalBottom);
        scroll.addView(root);

        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(horizontal, normalTop + bars.top, horizontal, normalBottom + bars.bottom);
            return insets;
        });

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.ic_logo);
        header.addView(logo, new LinearLayout.LayoutParams(dp(58), dp(58)));

        LinearLayout titleBlock = new LinearLayout(this);
        titleBlock.setOrientation(LinearLayout.VERTICAL);
        titleBlock.addView(text("RemindIt", 30, true, TEXT));
        titleBlock.addView(text(LanguageManager.pick(this,
                "Побач зараз. Згадай вчасно.",
                "See it now. Remember it later."), 14, false, MUTED));
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(0, -2, 1f);
        titleParams.setMargins(dp(10), 0, dp(8), 0);
        header.addView(titleBlock, titleParams);

        Button settings = secondaryButton("⚙");
        settings.setTextSize(20);
        settings.setOnClickListener(v -> startActivity(new Intent(this, SettingsActivity.class)));
        header.addView(settings, new LinearLayout.LayoutParams(dp(58), dp(48)));
        root.addView(header, margin(-1, -2, 0, 0, 0, 20));

        LinearLayout hero = card();
        hero.addView(text(LanguageManager.pick(this,
                "Збережи будь-що — RemindIt залишить суть, час і оригінал.",
                "Save anything — RemindIt keeps the meaning, time and original."),
                20, true, TEXT));
        hero.addView(text(LanguageManager.pick(this,
                "Скріншоти, фото, посилання й текст перетворюються на коротке нагадування, до якого можна повернутися.",
                "Screenshots, photos, links and text become concise reminders you can return to."),
                14, false, MUTED), margin(-1, -2, 0, 8, 0, 14));
        Button add = primaryButton(LanguageManager.pick(this, "＋ Додати нагадування", "＋ Add reminder"));
        add.setOnClickListener(v -> startActivity(new Intent(this, AddReminderActivity.class)));
        hero.addView(add);
        root.addView(hero, margin(-1, -2, 0, 0, 0, 14));

        LinearLayout tools = card();
        LinearLayout topTools = new LinearLayout(this);
        topTools.setOrientation(LinearLayout.HORIZONTAL);
        topTools.setGravity(Gravity.CENTER_VERTICAL);
        topTools.addView(text(LanguageManager.pick(this, "Пошук і фільтри", "Search & filters"), 17, true, TEXT),
                new LinearLayout.LayoutParams(0, -2, 1f));
        Button history = secondaryButton(LanguageManager.pick(this, "Історія", "History"));
        history.setOnClickListener(v -> startActivity(new Intent(this, HistoryActivity.class)));
        topTools.addView(history, new LinearLayout.LayoutParams(dp(112), dp(44)));
        tools.addView(topTools);

        searchInput = new EditText(this);
        searchInput.setSingleLine(true);
        searchInput.setHint(LanguageManager.pick(this, "Знайти нагадування…", "Search reminders…"));
        searchInput.setHintTextColor(Color.rgb(148, 163, 184));
        searchInput.setTextColor(TEXT);
        searchInput.setTextSize(15);
        searchInput.setPadding(dp(12), dp(10), dp(12), dp(10));
        searchInput.setBackground(rounded(Color.rgb(248, 250, 252), BORDER, 1, 14));
        searchInput.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) { renderReminders(); }
            @Override public void afterTextChanged(Editable s) {}
        });
        tools.addView(searchInput, margin(-1, dp(52), 0, 12, 0, 8));

        filterSpinner = new Spinner(this);
        String[] filters = LanguageManager.isUk(this)
                ? new String[]{"Усі категорії", "Особисте", "Покупки", "Подорожі", "Робота", "Платежі", "Інше"}
                : new String[]{"All categories", "Personal", "Shopping", "Travel", "Work", "Bills", "Other"};
        ArrayAdapter<String> filterAdapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, filters);
        filterAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        filterSpinner.setAdapter(filterAdapter);
        filterSpinner.setBackground(rounded(Color.rgb(248, 250, 252), BORDER, 1, 14));
        filterSpinner.setPadding(dp(10), 0, dp(10), 0);
        filterSpinner.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) { renderReminders(); }
            @Override public void onNothingSelected(android.widget.AdapterView<?> parent) {}
        });
        tools.addView(filterSpinner, new LinearLayout.LayoutParams(-1, dp(52)));
        root.addView(tools, margin(-1, -2, 0, 0, 0, 18));

        LinearLayout heading = new LinearLayout(this);
        heading.setOrientation(LinearLayout.HORIZONTAL);
        heading.setGravity(Gravity.CENTER_VERTICAL);
        heading.addView(text(LanguageManager.pick(this, "Майбутні", "Upcoming"), 23, true, TEXT),
                new LinearLayout.LayoutParams(0, -2, 1f));
        heading.addView(text(LanguageManager.pick(this, "Приватно • Локально", "Private • Local"),
                12, true, BLUE));
        root.addView(heading, margin(-1, -2, 0, 0, 0, 10));

        reminderList = new LinearLayout(this);
        reminderList.setOrientation(LinearLayout.VERTICAL);
        root.addView(reminderList);
        return scroll;
    }

    private void renderReminders() {
        if (reminderList == null) return;
        reminderList.removeAllViews();
        List<Reminder> all = new ReminderDb(this).getUpcoming();
        List<Reminder> reminders = filter(all);

        if (reminders.isEmpty()) {
            LinearLayout empty = card();
            TextView emoji = text("🔔", 34, false, TEXT);
            emoji.setGravity(Gravity.CENTER);
            TextView title = text(LanguageManager.pick(this,
                    all.isEmpty() ? "Поки нічого не потрібно пам’ятати" : "Нічого не знайдено",
                    all.isEmpty() ? "Nothing to remember yet" : "No reminders found"), 18, true, TEXT);
            title.setGravity(Gravity.CENTER);
            empty.addView(emoji);
            empty.addView(title, margin(-1, -2, 0, 8, 0, 0));
            reminderList.addView(empty);
            return;
        }

        SimpleDateFormat formatter = new SimpleDateFormat("EEE, dd MMM • HH:mm", LanguageManager.displayLocale(this));
        long now = System.currentTimeMillis();

        for (Reminder reminder : reminders) {
            LinearLayout item = card();
            TextView essence = text(!TextUtils.isEmpty(reminder.goal) ? reminder.goal : reminder.title,
                    18, true, TEXT);
            item.addView(essence);

            int timeColor = reminder.remindAt < now ? RED : BLUE;
            String timeText = formatter.format(new Date(reminder.remindAt));
            if (reminder.remindAt < now) {
                timeText = LanguageManager.pick(this, "Прострочено • ", "Overdue • ") + timeText;
            }
            item.addView(text(timeText, 13, true, timeColor), margin(-1, -2, 0, 6, 0, 5));

            if (reminder.isRepeating()) {
                item.addView(text("↻ " + repeatLabel(reminder.repeatMode), 12, true, BLUE), margin(-1, -2, 0, 0, 0, 5));
            }

            item.addView(text(sourceLabel(reminder), 12, true, MUTED), margin(-1, -2, 0, 0, 0, 8));

            if (reminder.hasImageOriginal() || reminder.hasLinkOriginal()) {
                Button original = secondaryButton(OriginalActions.actionLabel(this, reminder));
                original.setOnClickListener(v -> OriginalActions.open(this, reminder));
                item.addView(original, margin(-1, dp(46), 0, 0, 0, 8));
            }

            if (!TextUtils.isEmpty(reminder.body)) {
                Button details = secondaryButton(LanguageManager.pick(this, "Показати деталі", "Show details"));
                TextView raw = text(reminder.body, 13, false, MUTED);
                raw.setVisibility(View.GONE);
                raw.setPadding(dp(12), dp(10), dp(12), dp(10));
                raw.setBackground(rounded(Color.rgb(248, 250, 252), BORDER, 1, 12));
                details.setOnClickListener(v -> {
                    boolean show = raw.getVisibility() != View.VISIBLE;
                    raw.setVisibility(show ? View.VISIBLE : View.GONE);
                    details.setText(LanguageManager.pick(this,
                            show ? "Сховати деталі" : "Показати деталі",
                            show ? "Hide details" : "Show details"));
                });
                item.addView(details, margin(-1, dp(46), 0, 0, 0, 8));
                item.addView(raw, margin(-1, -2, 0, 0, 0, 10));
            }

            Button edit = secondaryButton(LanguageManager.pick(this, "✎ Редагувати", "✎ Edit"));
            edit.setOnClickListener(v -> {
                Intent intent = new Intent(this, EditReminderActivity.class);
                intent.putExtra("reminder_id", reminder.id);
                startActivity(intent);
            });
            item.addView(edit, margin(-1, dp(46), 0, 0, 0, 8));

            LinearLayout actions = new LinearLayout(this);
            actions.setOrientation(LinearLayout.HORIZONTAL);
            Button done = smallButton(LanguageManager.pick(this, "✓ Виконано", "✓ Done"), GREEN);
            done.setOnClickListener(v -> {
                if (reminder.isRepeating()) {
                    long next = ReminderScheduler.nextOccurrence(reminder, Math.max(System.currentTimeMillis(), reminder.remindAt));
                    if (next > 0) {
                        reminder.remindAt = next;
                        new ReminderDb(this).update(reminder);
                        ReminderScheduler.schedule(this, reminder);
                    }
                } else {
                    ReminderScheduler.cancel(this, reminder.id);
                    new ReminderDb(this).markDone(reminder.id);
                }
                renderReminders();
            });
            Button delete = smallButton(LanguageManager.pick(this, "Видалити", "Delete"), RED);
            delete.setOnClickListener(v -> {
                ReminderScheduler.cancel(this, reminder.id);
                new ReminderDb(this).delete(reminder.id);
                renderReminders();
            });
            actions.addView(done, new LinearLayout.LayoutParams(0, dp(44), 1f));
            actions.addView(new View(this), new LinearLayout.LayoutParams(dp(8), 1));
            actions.addView(delete, new LinearLayout.LayoutParams(0, dp(44), 1f));
            item.addView(actions);

            reminderList.addView(item, margin(-1, -2, 0, 0, 0, 10));
        }
    }

    private List<Reminder> filter(List<Reminder> input) {
        ArrayList<Reminder> out = new ArrayList<>();
        String query = searchInput == null ? "" : searchInput.getText().toString().trim().toLowerCase(Locale.ROOT);
        int filterPosition = filterSpinner == null ? 0 : filterSpinner.getSelectedItemPosition();
        String wantedCategory = filterPosition == 0 ? null : categoryKeyForFilter(filterPosition);

        for (Reminder reminder : input) {
            if (wantedCategory != null && !wantedCategory.equals(reminder.category)) continue;
            String haystack = ((reminder.goal == null ? "" : reminder.goal) + " "
                    + (reminder.title == null ? "" : reminder.title) + " "
                    + (reminder.body == null ? "" : reminder.body)).toLowerCase(Locale.ROOT);
            if (!query.isEmpty() && !haystack.contains(query)) continue;
            out.add(reminder);
        }
        return out;
    }

    private String categoryKeyForFilter(int position) {
        if (position == 1) return "Personal";
        if (position == 2) return "Shopping";
        if (position == 3) return "Travel";
        if (position == 4) return "Work";
        if (position == 5) return "Bills";
        if (position == 6) return "Other";
        return null;
    }

    private String repeatLabel(String mode) {
        if (Reminder.REPEAT_DAILY.equals(mode)) return LanguageManager.pick(this, "Щодня", "Daily");
        if (Reminder.REPEAT_WEEKDAYS.equals(mode)) return LanguageManager.pick(this, "Пн–Пт", "Weekdays");
        if (Reminder.REPEAT_WEEKLY.equals(mode)) return LanguageManager.pick(this, "Щотижня", "Weekly");
        return LanguageManager.pick(this, "Одноразово", "Once");
    }

    private String sourceLabel(Reminder reminder) {
        if (reminder.hasImageOriginal()) return "📷 " + LanguageManager.pick(this, "Оригінал збережено", "Original image saved");
        if (reminder.hasLinkOriginal()) return "🔗 " + LanguageManager.pick(this, "Оригінальне посилання збережено", "Original link saved");
        return "📝 " + LanguageManager.pick(this, "Текстове нагадування", "Text reminder");
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 100);
        }
    }

    private LinearLayout card() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(16), dp(16), dp(16), dp(16));
        layout.setBackground(rounded(Color.WHITE, BORDER, 1, 18));
        return layout;
    }

    private Button primaryButton(String label) {
        Button button = baseButton(label);
        button.setTextColor(Color.WHITE);
        button.setBackground(rounded(BLUE, BLUE_DARK, 1, 16));
        return button;
    }

    private Button secondaryButton(String label) {
        Button button = baseButton(label);
        button.setTextColor(BLUE);
        button.setBackground(rounded(Color.WHITE, BLUE, 1, 14));
        return button;
    }

    private Button smallButton(String label, int color) {
        Button button = baseButton(label);
        button.setTextColor(color);
        button.setTextSize(13);
        button.setBackground(rounded(Color.WHITE, color, 1, 13));
        return button;
    }

    private Button baseButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(14);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        return button;
    }

    private TextView text(String value, int sp, boolean bold, int color) {
        TextView textView = new TextView(this);
        textView.setText(value);
        textView.setTextSize(sp);
        textView.setTextColor(color);
        if (bold) textView.setTypeface(Typeface.DEFAULT_BOLD);
        return textView;
    }

    private GradientDrawable rounded(int fill, int stroke, int strokeWidth, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(radius));
        drawable.setStroke(dp(strokeWidth), stroke);
        return drawable;
    }

    private LinearLayout.LayoutParams margin(int width, int height, int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(width, height);
        params.setMargins(dp(left), dp(top), dp(right), dp(bottom));
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
