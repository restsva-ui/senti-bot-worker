package com.remindit.app;

import android.app.Activity;
import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Locale;

public class EditReminderActivity extends Activity {
    private static final int BLUE = Color.rgb(10, 132, 255);
    private static final int BLUE_DARK = Color.rgb(6, 105, 216);
    private static final int TEXT = Color.rgb(15, 23, 42);
    private static final int MUTED = Color.rgb(100, 116, 139);
    private static final int BG = Color.rgb(247, 250, 255);
    private static final int BORDER = Color.rgb(226, 232, 240);

    private Reminder reminder;
    private EditText meaningInput;
    private Spinner categorySpinner;
    private Spinner repeatSpinner;
    private Spinner leadSpinner;
    private Spinner secondLeadSpinner;
    private Spinner followUpSpinner;
    private TextView dateValue;
    private TextView timeValue;
    private final Calendar selected = Calendar.getInstance();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        long id = getIntent().getLongExtra("reminder_id", -1L);
        reminder = new ReminderDb(this).get(id);
        if (reminder == null) {
            finish();
            return;
        }

        selected.setTimeInMillis(reminder.remindAt);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(Color.WHITE);
        setContentView(buildUi());
        refreshDateTime();
    }

    private View buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        final int horizontal = dp(18);
        final int top = dp(16);
        final int bottom = dp(36);
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
        header.addView(text(LanguageManager.pick(this, "Редагувати нагадування", "Edit reminder"), 25, true, TEXT),
                new LinearLayout.LayoutParams(0, -2, 1f));
        root.addView(header, margin(-1, -2, 0, 0, 0, 14));

        LinearLayout meaningCard = card();
        meaningCard.addView(label(LanguageManager.pick(this, "Суть нагадування", "Reminder meaning")));
        meaningInput = input(LanguageManager.pick(this, "Коротко: що саме треба згадати?", "What exactly should you remember?"), true);
        meaningInput.setText(!TextUtils.isEmpty(reminder.goal) ? reminder.goal : reminder.title);
        meaningCard.addView(meaningInput, margin(-1, dp(110), 0, 6, 0, 0));
        root.addView(meaningCard, margin(-1, -2, 0, 0, 0, 12));

        LinearLayout options = card();
        options.addView(label(LanguageManager.pick(this, "Категорія", "Category")));
        categorySpinner = new Spinner(this);
        ArrayAdapter<String> categories = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item, LanguageManager.categories(this));
        categories.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        categorySpinner.setAdapter(categories);
        categorySpinner.setBackground(rounded(Color.rgb(248, 250, 252), BORDER, 1, 14));
        categorySpinner.setPadding(dp(10), 0, dp(10), 0);
        options.addView(categorySpinner, margin(-1, dp(54), 0, 6, 0, 14));
        setCategory(reminder.category);

        options.addView(label(LanguageManager.pick(this, "Повтор", "Repeat")));
        repeatSpinner = new Spinner(this);
        String[] repeatLabels = LanguageManager.isUk(this)
                ? new String[]{"Одноразово", "Щодня", "Пн–Пт", "Щотижня"}
                : new String[]{"Once", "Daily", "Weekdays", "Weekly"};
        ArrayAdapter<String> repeatAdapter = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item, repeatLabels);
        repeatAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        repeatSpinner.setAdapter(repeatAdapter);
        repeatSpinner.setBackground(rounded(Color.rgb(248, 250, 252), BORDER, 1, 14));
        repeatSpinner.setPadding(dp(10), 0, dp(10), 0);
        options.addView(repeatSpinner, margin(-1, dp(54), 0, 6, 0, 0));
        repeatSpinner.setSelection(repeatPosition(reminder.repeatMode));

        options.addView(label(LanguageManager.pick(this, "Основне попередження", "Primary alert")),
                margin(-1, -2, 0, 14, 0, 0));
        leadSpinner = optionSpinner(ReminderUi.leadLabels(this, false));
        leadSpinner.setSelection(ReminderUi.indexOf(ReminderUi.LEAD_VALUES, reminder.leadMinutes));
        options.addView(leadSpinner, margin(-1, dp(54), 0, 6, 0, 0));

        options.addView(label(LanguageManager.pick(this, "Додаткове попередження", "Additional alert")),
                margin(-1, -2, 0, 12, 0, 0));
        secondLeadSpinner = optionSpinner(ReminderUi.leadLabels(this, true));
        secondLeadSpinner.setSelection(ReminderUi.indexOf(ReminderUi.SECOND_LEAD_VALUES, reminder.secondLeadMinutes));
        options.addView(secondLeadSpinner, margin(-1, dp(54), 0, 6, 0, 0));

        options.addView(label(LanguageManager.pick(this, "Якщо не виконано", "If not completed")),
                margin(-1, -2, 0, 12, 0, 0));
        followUpSpinner = optionSpinner(ReminderUi.followUpLabels(this));
        followUpSpinner.setSelection(ReminderUi.indexOf(ReminderUi.FOLLOW_UP_VALUES, reminder.followUpMinutes));
        options.addView(followUpSpinner, margin(-1, dp(54), 0, 6, 0, 0));
        root.addView(options, margin(-1, -2, 0, 0, 0, 12));

        LinearLayout when = card();
        when.addView(text(LanguageManager.pick(this, "Коли відбудеться подія?", "When is the event?"), 18, true, TEXT));
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout dateBlock = valueBlock(LanguageManager.pick(this, "Дата", "Date"));
        dateValue = (TextView) dateBlock.getChildAt(1);
        dateValue.setOnClickListener(v -> pickDate());
        LinearLayout timeBlock = valueBlock(LanguageManager.pick(this, "Час", "Time"));
        timeValue = (TextView) timeBlock.getChildAt(1);
        timeValue.setOnClickListener(v -> pickTime());
        row.addView(dateBlock, new LinearLayout.LayoutParams(0, -2, 1f));
        row.addView(new View(this), new LinearLayout.LayoutParams(dp(10), 1));
        row.addView(timeBlock, new LinearLayout.LayoutParams(0, -2, 1f));
        when.addView(row, margin(-1, -2, 0, 12, 0, 0));
        root.addView(when, margin(-1, -2, 0, 0, 0, 12));

        if (reminder.hasImageOriginal() || reminder.hasLinkOriginal()) {
            Button original = secondaryButton(OriginalActions.actionLabel(this, reminder));
            original.setOnClickListener(v -> OriginalActions.open(this, reminder));
            root.addView(original, margin(-1, dp(50), 0, 0, 0, 10));
        }

        Button save = primaryButton(LanguageManager.pick(this, "Зберегти зміни", "Save changes"));
        save.setOnClickListener(v -> save());
        root.addView(save, new LinearLayout.LayoutParams(-1, dp(58)));
        return scroll;
    }

    private void save() {
        String meaning = meaningInput.getText().toString().trim();
        if (meaning.isEmpty()) {
            Toast.makeText(this, LanguageManager.pick(this, "Додай суть нагадування", "Add reminder meaning"), Toast.LENGTH_SHORT).show();
            return;
        }
        if (selected.getTimeInMillis() <= System.currentTimeMillis()) {
            Toast.makeText(this, LanguageManager.pick(this, "Обери час у майбутньому", "Choose a future time"), Toast.LENGTH_SHORT).show();
            return;
        }

        ReminderScheduler.cancel(this, reminder.id);
        reminder.goal = meaning;
        reminder.title = conciseTitle(meaning);
        reminder.category = LanguageManager.categoryKeyFromDisplay(String.valueOf(categorySpinner.getSelectedItem()));
        reminder.repeatMode = repeatMode(repeatSpinner.getSelectedItemPosition());
        reminder.leadMinutes = selectedValue(leadSpinner, ReminderUi.LEAD_VALUES);
        reminder.secondLeadMinutes = selectedValue(secondLeadSpinner, ReminderUi.SECOND_LEAD_VALUES);
        reminder.followUpMinutes = selectedValue(followUpSpinner, ReminderUi.FOLLOW_UP_VALUES);
        if (reminder.isRepeating()) reminder.followUpMinutes = 0;
        reminder.remindAt = selected.getTimeInMillis();
        reminder.done = false;
        reminder.completedAt = 0;
        reminder.snoozeAt = 0L;
        new ReminderDb(this).update(reminder);
        boolean exact = ReminderScheduler.schedule(this, reminder);
        if (!exact && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Toast.makeText(this,
                    LanguageManager.pick(this,
                            "Збережено. Дозволь точні нагадування у Налаштуваннях RemindIt.",
                            "Saved. Allow exact reminders in RemindIt Settings."),
                    Toast.LENGTH_LONG).show();
            startActivity(new Intent(this, SettingsActivity.class));
            finish();
            return;
        }
        Toast.makeText(this, LanguageManager.pick(this, "Зміни збережено", "Changes saved"), Toast.LENGTH_SHORT).show();
        finish();
    }

    private void pickDate() {
        new DatePickerDialog(this, (view, year, month, day) -> {
            selected.set(Calendar.YEAR, year);
            selected.set(Calendar.MONTH, month);
            selected.set(Calendar.DAY_OF_MONTH, day);
            refreshDateTime();
        }, selected.get(Calendar.YEAR), selected.get(Calendar.MONTH), selected.get(Calendar.DAY_OF_MONTH)).show();
    }

    private void pickTime() {
        new TimePickerDialog(this, (view, hour, minute) -> {
            selected.set(Calendar.HOUR_OF_DAY, hour);
            selected.set(Calendar.MINUTE, minute);
            selected.set(Calendar.SECOND, 0);
            selected.set(Calendar.MILLISECOND, 0);
            refreshDateTime();
        }, selected.get(Calendar.HOUR_OF_DAY), selected.get(Calendar.MINUTE), true).show();
    }

    private void refreshDateTime() {
        if (dateValue != null) dateValue.setText(new SimpleDateFormat("dd.MM.yyyy", Locale.getDefault()).format(selected.getTime()));
        if (timeValue != null) timeValue.setText(new SimpleDateFormat("HH:mm", Locale.getDefault()).format(selected.getTime()));
    }

    private void setCategory(String key) {
        String display = LanguageManager.categoryDisplay(this, key);
        for (int i = 0; i < categorySpinner.getCount(); i++) {
            if (display.equals(String.valueOf(categorySpinner.getItemAtPosition(i)))) {
                categorySpinner.setSelection(i);
                break;
            }
        }
    }

    private int repeatPosition(String mode) {
        if (Reminder.REPEAT_DAILY.equals(mode)) return 1;
        if (Reminder.REPEAT_WEEKDAYS.equals(mode)) return 2;
        if (Reminder.REPEAT_WEEKLY.equals(mode)) return 3;
        return 0;
    }

    private String repeatMode(int position) {
        if (position == 1) return Reminder.REPEAT_DAILY;
        if (position == 2) return Reminder.REPEAT_WEEKDAYS;
        if (position == 3) return Reminder.REPEAT_WEEKLY;
        return Reminder.REPEAT_ONCE;
    }

    private String conciseTitle(String value) {
        String clean = value.replaceAll("\\s+", " ").trim();
        return clean.length() <= 64 ? clean : clean.substring(0, 61) + "…";
    }

    private Spinner optionSpinner(String[] labels) {
        Spinner spinner = new Spinner(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item, labels);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinner.setAdapter(adapter);
        spinner.setBackground(rounded(Color.rgb(248, 250, 252), BORDER, 1, 14));
        spinner.setPadding(dp(10), 0, dp(10), 0);
        return spinner;
    }

    private int selectedValue(Spinner spinner, int[] values) {
        int position = spinner == null ? 0 : spinner.getSelectedItemPosition();
        return position >= 0 && position < values.length ? values[position] : values[0];
    }

    private LinearLayout valueBlock(String label) {
        LinearLayout block = new LinearLayout(this);
        block.setOrientation(LinearLayout.VERTICAL);
        block.addView(text(label, 12, true, MUTED));
        TextView value = text("", 17, true, TEXT);
        value.setGravity(Gravity.CENTER);
        value.setPadding(dp(10), dp(15), dp(10), dp(15));
        value.setBackground(rounded(Color.rgb(248, 250, 252), BORDER, 1, 14));
        block.addView(value, margin(-1, -2, 0, 5, 0, 0));
        return block;
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(16), dp(16), dp(16));
        card.setBackground(rounded(Color.WHITE, BORDER, 1, 18));
        return card;
    }

    private EditText input(String hint, boolean multiline) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setHintTextColor(Color.rgb(148, 163, 184));
        input.setTextColor(TEXT);
        input.setTextSize(16);
        input.setPadding(dp(14), dp(12), dp(14), dp(12));
        input.setBackground(rounded(Color.rgb(248, 250, 252), BORDER, 1, 14));
        if (multiline) input.setGravity(Gravity.TOP | Gravity.START);
        else input.setSingleLine(true);
        return input;
    }

    private TextView label(String value) { return text(value, 13, true, MUTED); }

    private Button primaryButton(String label) {
        Button b = baseButton(label);
        b.setTextColor(Color.WHITE);
        b.setBackground(rounded(BLUE, BLUE_DARK, 1, 16));
        return b;
    }

    private Button secondaryButton(String label) {
        Button b = baseButton(label);
        b.setTextColor(BLUE);
        b.setBackground(rounded(Color.WHITE, BLUE, 1, 14));
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
