package com.remindit.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Parcelable;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
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

public class AddReminderActivity extends Activity {
    private static final int BLUE = Color.rgb(10, 132, 255);
    private static final int BLUE_DARK = Color.rgb(6, 105, 216);
    private static final int YELLOW = Color.rgb(255, 200, 61);
    private static final int TEXT = Color.rgb(15, 23, 42);
    private static final int MUTED = Color.rgb(100, 116, 139);
    private static final int BG = Color.rgb(247, 250, 255);
    private static final int BORDER = Color.rgb(226, 232, 240);
    private static final int SMART_BG = Color.rgb(255, 251, 235);

    private EditText goalInput;
    private EditText rawInput;
    private Spinner categorySpinner;
    private Spinner repeatSpinner;
    private Spinner leadSpinner;
    private Spinner secondLeadSpinner;
    private Spinner followUpSpinner;
    private TextView dateValue;
    private TextView timeValue;
    private TextView sourceBadge;
    private TextView smartHint;
    private TextView detectedFacts;
    private LinearLayout rawSection;
    private Button rawToggle;
    private Button originalButton;
    private Button quickSaveButton;

    private final Calendar selected = Calendar.getInstance();
    private String sourceType = "manual";
    private String imagePath;
    private String sourceUri;
    private String intentType = "remember";
    private String generatedTitle = "";
    private boolean rawVisible = true;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(Color.WHITE);

        selected.add(Calendar.HOUR_OF_DAY, 1);
        selected.set(Calendar.MINUTE, ((selected.get(Calendar.MINUTE) + 4) / 5) * 5);
        if (selected.get(Calendar.MINUTE) >= 60) {
            selected.add(Calendar.HOUR_OF_DAY, 1);
            selected.set(Calendar.MINUTE, 0);
        }
        selected.set(Calendar.SECOND, 0);
        selected.set(Calendar.MILLISECOND, 0);

        setContentView(buildUi());
        refreshDateTime();
        handleIncoming(getIntent());
    }

    private View buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        final int horizontal = dp(18);
        final int normalTop = dp(18);
        final int normalBottom = dp(38);
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

        Button back = new Button(this);
        back.setText("‹");
        back.setTextSize(30);
        back.setTextColor(TEXT);
        back.setBackgroundColor(Color.TRANSPARENT);
        back.setOnClickListener(v -> finish());
        header.addView(back, new LinearLayout.LayoutParams(dp(50), dp(52)));

        LinearLayout titleBlock = new LinearLayout(this);
        titleBlock.setOrientation(LinearLayout.VERTICAL);
        titleBlock.addView(text(LanguageManager.pick(this, "Нове нагадування", "New reminder"), 25, true, TEXT));
        titleBlock.addView(text(LanguageManager.pick(this,
                "Одна суть. Один час. Один оригінал.",
                "One meaning. One time. One original."), 13, false, MUTED));
        header.addView(titleBlock, new LinearLayout.LayoutParams(0, -2, 1f));

        Button settings = secondaryButton("⚙");
        settings.setTextSize(20);
        settings.setOnClickListener(v -> startActivity(new Intent(this, SettingsActivity.class)));
        header.addView(settings, new LinearLayout.LayoutParams(dp(54), dp(46)));

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.ic_logo);
        LinearLayout.LayoutParams logoParams = new LinearLayout.LayoutParams(dp(48), dp(48));
        logoParams.setMargins(dp(6), 0, 0, 0);
        header.addView(logo, logoParams);

        root.addView(header, margin(-1, -2, 0, 0, 0, 18));

        LinearLayout sourceCard = card();
        LinearLayout sourceRow = new LinearLayout(this);
        sourceRow.setOrientation(LinearLayout.HORIZONTAL);
        sourceRow.setGravity(Gravity.CENTER_VERTICAL);

        sourceBadge = pill(LanguageManager.pick(this, "ВРУЧНУ", "MANUAL"), BLUE);
        sourceRow.addView(sourceBadge);
        sourceRow.addView(text(LanguageManager.pick(this,
                "  Оригінал зберігається разом із нагадуванням",
                "  Original stays with the reminder"), 12, true, MUTED),
                new LinearLayout.LayoutParams(0, -2, 1f));
        sourceCard.addView(sourceRow);

        smartHint = text(LanguageManager.pick(this,
                "Напиши або поділись тим, про що треба пам’ятати — RemindIt сформує коротку людську суть.",
                "Type or share what matters and RemindIt will form a short human-readable meaning."),
                13, false, MUTED);
        sourceCard.addView(smartHint, margin(-1, -2, 0, 9, 0, 0));

        detectedFacts = text("", 13, true, BLUE);
        detectedFacts.setVisibility(View.GONE);
        sourceCard.addView(detectedFacts, margin(-1, -2, 0, 8, 0, 0));

        originalButton = secondaryButton(LanguageManager.pick(this, "Переглянути оригінал", "View original"));
        originalButton.setVisibility(View.GONE);
        originalButton.setOnClickListener(v -> openCurrentOriginal());
        sourceCard.addView(originalButton, margin(-1, dp(48), 0, 10, 0, 0));
        quickSaveButton = primaryButton(LanguageManager.pick(this,
                "⚡ Зберегти з розумними налаштуваннями",
                "⚡ Save with smart settings"));
        quickSaveButton.setOnClickListener(v -> saveReminder());
        sourceCard.addView(quickSaveButton, margin(-1, dp(52), 0, 10, 0, 0));
        root.addView(sourceCard, margin(-1, -2, 0, 0, 0, 12));

        LinearLayout essenceCard = card();
        essenceCard.setBackground(rounded(SMART_BG, YELLOW, 1, 18));
        essenceCard.addView(text("✨ " + LanguageManager.pick(this, "Суть нагадування", "Reminder meaning"),
                18, true, TEXT));
        essenceCard.addView(text(LanguageManager.pick(this,
                "Це саме той короткий текст, який з’явиться у сповіщенні.",
                "This is the short text that will appear in the notification."),
                12, false, MUTED), margin(-1, -2, 0, 4, 0, 8));

        goalInput = input(LanguageManager.pick(this,
                "Наприклад: Переглянути новину про… / Оплатити рахунок… / Відповісти…",
                "For example: Review the article… / Pay the bill… / Reply…"), true);
        goalInput.setMinLines(2);
        goalInput.setMaxLines(4);
        essenceCard.addView(goalInput, margin(-1, dp(92), 0, 4, 0, 10));

        Button analyzeButton = secondaryButton(LanguageManager.pick(this, "✨ Оновити суть", "✨ Refresh meaning"));
        analyzeButton.setOnClickListener(v -> {
            v.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
            String source = rawInput.getText().toString().trim();
            if (source.isEmpty()) {
                source = goalInput.getText().toString().trim();
            }
            if (source.isEmpty()) {
                Toast.makeText(this,
                        LanguageManager.pick(this, "Спочатку додай вихідний текст або примітку", "Add source text or a note first"),
                        Toast.LENGTH_SHORT).show();
                return;
            }
            applySmartSuggestions(source);
            Toast.makeText(this,
                    LanguageManager.pick(this, "Суть оновлено", "Meaning updated"),
                    Toast.LENGTH_SHORT).show();
        });
        essenceCard.addView(analyzeButton, new LinearLayout.LayoutParams(-1, dp(50)));
        root.addView(essenceCard, margin(-1, -2, 0, 0, 0, 12));

        LinearLayout categoryCard = card();
        categoryCard.addView(label(LanguageManager.pick(this, "Категорія", "Category")));
        categorySpinner = new Spinner(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item, LanguageManager.categories(this));
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        categorySpinner.setAdapter(adapter);
        categorySpinner.setPadding(dp(12), 0, dp(12), 0);
        categorySpinner.setBackground(rounded(Color.rgb(248, 250, 252), BORDER, 1, 14));
        categoryCard.addView(categorySpinner, margin(-1, dp(54), 0, 6, 0, 14));
        categoryCard.addView(label(LanguageManager.pick(this, "Повтор події", "Repeat event")));
        repeatSpinner = optionSpinner(LanguageManager.isUk(this)
                ? new String[]{"Одноразово", "Щодня", "Пн–Пт", "Щотижня"}
                : new String[]{"Once", "Daily", "Weekdays", "Weekly"});
        categoryCard.addView(repeatSpinner, margin(-1, dp(54), 0, 6, 0, 0));
        root.addView(categoryCard, margin(-1, -2, 0, 0, 0, 12));

        LinearLayout rawCard = card();
        rawToggle = secondaryButton(LanguageManager.pick(this, "Сховати вихідний текст", "Hide source text"));
        rawToggle.setOnClickListener(v -> setRawVisible(!rawVisible));
        rawCard.addView(rawToggle);

        rawSection = new LinearLayout(this);
        rawSection.setOrientation(LinearLayout.VERTICAL);
        rawSection.addView(label(LanguageManager.pick(this, "Вихідний текст / OCR / примітка", "Source text / OCR / note")),
                margin(-1, -2, 0, 12, 0, 0));
        rawInput = input(LanguageManager.pick(this,
                "Тут зберігається повний вихідний текст…",
                "The full source text is stored here…"), true);
        rawInput.setMinLines(4);
        rawInput.setMaxLines(8);
        rawSection.addView(rawInput, margin(-1, dp(160), 0, 6, 0, 0));
        rawCard.addView(rawSection);
        root.addView(rawCard, margin(-1, -2, 0, 0, 0, 12));

        LinearLayout when = card();
        when.addView(text(LanguageManager.pick(this, "Коли відбудеться подія?", "When is the event?"), 18, true, TEXT));
        LinearLayout dateTime = new LinearLayout(this);
        dateTime.setOrientation(LinearLayout.HORIZONTAL);

        LinearLayout dateBlock = valueBlock(LanguageManager.pick(this, "Дата", "Date"));
        dateValue = (TextView) dateBlock.getChildAt(1);
        dateValue.setOnClickListener(v -> pickDate());

        LinearLayout timeBlock = valueBlock(LanguageManager.pick(this, "Час", "Time"));
        timeValue = (TextView) timeBlock.getChildAt(1);
        timeValue.setOnClickListener(v -> pickTime());

        dateTime.addView(dateBlock, new LinearLayout.LayoutParams(0, -2, 1f));
        dateTime.addView(new View(this), new LinearLayout.LayoutParams(dp(10), 1));
        dateTime.addView(timeBlock, new LinearLayout.LayoutParams(0, -2, 1f));
        when.addView(dateTime, margin(-1, -2, 0, 12, 0, 0));

        when.addView(label(LanguageManager.pick(this, "Основне попередження", "Primary alert")),
                margin(-1, -2, 0, 14, 0, 0));
        leadSpinner = optionSpinner(ReminderUi.leadLabels(this, false));
        when.addView(leadSpinner, margin(-1, dp(54), 0, 6, 0, 0));

        when.addView(label(LanguageManager.pick(this, "Додаткове попередження", "Additional alert")),
                margin(-1, -2, 0, 12, 0, 0));
        secondLeadSpinner = optionSpinner(ReminderUi.leadLabels(this, true));
        when.addView(secondLeadSpinner, margin(-1, dp(54), 0, 6, 0, 0));

        when.addView(label(LanguageManager.pick(this, "Якщо не виконано", "If not completed")),
                margin(-1, -2, 0, 12, 0, 0));
        followUpSpinner = optionSpinner(ReminderUi.followUpLabels(this));
        when.addView(followUpSpinner, margin(-1, dp(54), 0, 6, 0, 0));
        setTimingDefaults(ReminderTiming.defaultsFor("remember"));
        root.addView(when, margin(-1, -2, 0, 0, 0, 14));

        Button save = new Button(this);
        save.setText(LanguageManager.pick(this, "Зберегти нагадування", "Save reminder"));
        save.setAllCaps(false);
        save.setTextSize(17);
        save.setTypeface(Typeface.DEFAULT_BOLD);
        save.setTextColor(Color.WHITE);
        save.setBackground(rounded(BLUE, BLUE_DARK, 1, 18));
        save.setOnClickListener(v -> saveReminder());
        root.addView(save, new LinearLayout.LayoutParams(-1, dp(58)));

        return scroll;
    }

    private void handleIncoming(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String type = intent.getType();

        if (type != null && type.startsWith("image/")) {
            sourceType = "image";
            sourceBadge.setText(LanguageManager.pick(this, "ЗОБРАЖЕННЯ", "IMAGE"));
            sourceBadge.setBackground(rounded(YELLOW, YELLOW, 1, 12));
            sourceBadge.setTextColor(TEXT);
            Uri uri = readSharedUri(intent);
            if (uri == null) {
                smartHint.setText(LanguageManager.pick(this, "Не вдалося відкрити зображення.", "Could not open the image."));
                return;
            }

            imagePath = OriginalStore.saveImage(this, uri);
            updateOriginalButton();
            setQuickSaveEnabled(false);
            smartHint.setText(LanguageManager.pick(this,
                    "Оригінальне зображення збережено. Читаю текст і формую коротку суть…",
                    "Original image saved. Reading text and forming a short meaning…"));
            setRawVisible(false);

            OcrHelper.recognize(this, uri, new OcrHelper.Callback() {
                @Override
                public void onSuccess(String recognizedText) {
                    setQuickSaveEnabled(true);
                    rawInput.setText(recognizedText);
                    if (recognizedText.trim().isEmpty()) {
                        goalInput.setText(LanguageManager.pick(AddReminderActivity.this,
                                "Переглянути збережене зображення",
                                "Review the saved image"));
                        generatedTitle = goalInput.getText().toString();
                        intentType = "review";
                        return;
                    }
                    applySmartSuggestions(recognizedText);
                }

                @Override
                public void onError(Exception error) {
                    setQuickSaveEnabled(true);
                    goalInput.setText(LanguageManager.pick(AddReminderActivity.this,
                            "Переглянути збережене зображення",
                            "Review the saved image"));
                    generatedTitle = goalInput.getText().toString();
                    smartHint.setText(LanguageManager.pick(AddReminderActivity.this,
                            "Оригінал збережено. OCR не зміг надійно прочитати текст — суть можна відредагувати вручну.",
                            "Original saved. OCR could not reliably read the text; edit the meaning manually."));
                }
            });
            return;
        }

        String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (sharedText == null) sharedText = "";
        sourceUri = OriginalStore.firstUrl(sharedText);
        sourceType = sourceUri != null ? "link" : "text";
        sourceBadge.setText(LanguageManager.pick(this,
                sourceUri != null ? "ПОСИЛАННЯ" : "ТЕКСТ",
                sourceUri != null ? "LINK" : "TEXT"));
        rawInput.setText(sharedText);
        setQuickSaveEnabled(true);
        updateOriginalButton();
        setRawVisible(false);
        applySmartSuggestions(sharedText);
    }

    @SuppressWarnings("deprecation")
    private Uri readSharedUri(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) {
            return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        }
        Parcelable value = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        return value instanceof Uri ? (Uri) value : null;
    }

    private void applySmartSuggestions(String text) {
        long detected = DateDetector.detect(text);
        if (detected > System.currentTimeMillis()) {
            selected.setTimeInMillis(detected);
            refreshDateTime();
        }

        if (sourceUri == null) sourceUri = OriginalStore.firstUrl(text);
        if (sourceUri != null && "text".equals(sourceType)) sourceType = "link";

        ReminderIntentAnalyzer.Result analysis = ReminderIntentAnalyzer.analyze(this, text, sourceType);
        intentType = analysis.intentType;
        generatedTitle = analysis.title;
        goalInput.setText(analysis.goal);
        setCategory(analysis.categoryKey);
        setTimingDefaults(ReminderTiming.defaultsFor(analysis.intentType));
        String facts = DetectedFacts.summary(this, text);
        detectedFacts.setText(facts);
        detectedFacts.setVisibility(facts.isEmpty() ? View.GONE : View.VISIBLE);
        smartHint.setText(LanguageManager.pick(this,
                "Суть сформована окремо від вихідних даних. Перевір її — саме вона прийде у сповіщенні.",
                "Meaning is separated from raw source data. Check it; this is what the notification will show."));
        updateOriginalButton();
    }

    private void saveReminder() {
        String goal = goalInput.getText().toString().trim();
        String raw = rawInput.getText().toString().trim();

        if (TextUtils.isEmpty(goal)) {
            if (raw.isEmpty()) {
                Toast.makeText(this,
                        LanguageManager.pick(this, "Додай суть або вихідний текст", "Add a meaning or source text"),
                        Toast.LENGTH_SHORT).show();
                return;
            }
            applySmartSuggestions(raw);
            goal = goalInput.getText().toString().trim();
        }
        if (selected.getTimeInMillis() <= System.currentTimeMillis()) {
            Toast.makeText(this,
                    LanguageManager.pick(this, "Обери час у майбутньому", "Choose a time in the future"),
                    Toast.LENGTH_SHORT).show();
            return;
        }

        if (sourceUri == null) sourceUri = OriginalStore.firstUrl(raw);
        if (sourceUri != null && ("manual".equals(sourceType) || "text".equals(sourceType))) sourceType = "link";
        if (TextUtils.isEmpty(generatedTitle)) generatedTitle = conciseTitle(goal);

        Reminder reminder = new Reminder();
        reminder.title = generatedTitle;
        reminder.body = raw;
        reminder.goal = goal;
        reminder.intentType = intentType;
        reminder.category = LanguageManager.categoryKeyFromDisplay(String.valueOf(categorySpinner.getSelectedItem()));
        reminder.sourceType = sourceType;
        reminder.imagePath = imagePath;
        reminder.sourceUri = sourceUri;
        reminder.repeatMode = repeatMode(repeatSpinner == null ? 0 : repeatSpinner.getSelectedItemPosition());
        reminder.leadMinutes = selectedValue(leadSpinner, ReminderUi.LEAD_VALUES);
        reminder.secondLeadMinutes = selectedValue(secondLeadSpinner, ReminderUi.SECOND_LEAD_VALUES);
        reminder.followUpMinutes = selectedValue(followUpSpinner, ReminderUi.FOLLOW_UP_VALUES);
        if (reminder.isRepeating()) reminder.followUpMinutes = 0;
        reminder.remindAt = selected.getTimeInMillis();
        reminder.createdAt = System.currentTimeMillis();
        reminder.done = false;

        ReminderDb db = new ReminderDb(this);
        Reminder duplicate = db.findActiveDuplicate(reminder);
        if (duplicate != null) {
            new AlertDialog.Builder(this)
                    .setTitle(LanguageManager.pick(this, "Схоже нагадування вже є", "A similar reminder already exists"))
                    .setMessage(LanguageManager.pick(this,
                            "Оновити існуюче нагадування чи зберегти ще одне?",
                            "Update the existing reminder or keep another copy?"))
                    .setPositiveButton(LanguageManager.pick(this, "Оновити", "Update"),
                            (dialog, which) -> persistReminder(reminder, duplicate))
                    .setNeutralButton(LanguageManager.pick(this, "Зберегти окремо", "Save another"),
                            (dialog, which) -> persistReminder(reminder, null))
                    .setNegativeButton(LanguageManager.pick(this, "Скасувати", "Cancel"), null)
                    .show();
            return;
        }
        persistReminder(reminder, null);
    }

    private void persistReminder(Reminder reminder, Reminder duplicate) {
        ReminderDb db = new ReminderDb(this);
        if (duplicate == null) {
            reminder.id = db.insert(reminder);
        } else {
            ReminderScheduler.cancel(this, duplicate.id);
            String oldImagePath = duplicate.imagePath;
            reminder.id = duplicate.id;
            reminder.createdAt = duplicate.createdAt;
            db.update(reminder);
            if (oldImagePath != null && !oldImagePath.equals(reminder.imagePath)) {
                OriginalStore.deletePath(oldImagePath);
            }
        }
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

        Toast.makeText(this,
                LanguageManager.pick(this,
                        duplicate == null ? "Нагадування збережено" : "Нагадування оновлено",
                        duplicate == null ? "Reminder saved" : "Reminder updated"),
                Toast.LENGTH_SHORT).show();
        finish();
    }

    private String conciseTitle(String goal) {
        String clean = goal == null ? "" : goal.replaceAll("\\s+", " ").trim();
        return clean.length() <= 64 ? clean : clean.substring(0, 61) + "…";
    }

    private void setRawVisible(boolean visible) {
        rawVisible = visible;
        if (rawSection != null) rawSection.setVisibility(visible ? View.VISIBLE : View.GONE);
        if (rawToggle != null) rawToggle.setText(LanguageManager.pick(this,
                visible ? "Сховати вихідний текст" : "Показати вихідний текст",
                visible ? "Hide source text" : "Show source text"));
    }

    private void updateOriginalButton() {
        if (originalButton == null) return;
        if (imagePath != null) {
            originalButton.setVisibility(View.VISIBLE);
            originalButton.setText(LanguageManager.pick(this, "Переглянути оригінальне фото", "View original image"));
        } else if (sourceUri != null) {
            originalButton.setVisibility(View.VISIBLE);
            originalButton.setText(LanguageManager.pick(this, "Перейти за оригінальним посиланням", "Open original link"));
        } else {
            originalButton.setVisibility(View.GONE);
        }
    }

    private void openCurrentOriginal() {
        try {
            if (imagePath != null) {
                Intent intent = new Intent(this, OriginalViewerActivity.class);
                intent.putExtra("image_path", imagePath);
                startActivity(intent);
            } else if (sourceUri != null) {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(sourceUri)));
            }
        } catch (Exception e) {
            Toast.makeText(this,
                    LanguageManager.pick(this, "Не вдалося відкрити оригінал", "Could not open original"),
                    Toast.LENGTH_SHORT).show();
        }
    }

    private void setCategory(String categoryKey) {
        String display = LanguageManager.categoryDisplay(this, categoryKey);
        for (int i = 0; i < categorySpinner.getCount(); i++) {
            if (display.equals(String.valueOf(categorySpinner.getItemAtPosition(i)))) {
                categorySpinner.setSelection(i);
                return;
            }
        }
    }

    private Spinner optionSpinner(String[] labels) {
        Spinner spinner = new Spinner(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item, labels);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinner.setAdapter(adapter);
        spinner.setPadding(dp(12), 0, dp(12), 0);
        spinner.setBackground(rounded(Color.rgb(248, 250, 252), BORDER, 1, 14));
        return spinner;
    }

    private void setTimingDefaults(ReminderTiming.Defaults defaults) {
        if (leadSpinner != null) {
            leadSpinner.setSelection(ReminderUi.indexOf(ReminderUi.LEAD_VALUES, defaults.leadMinutes));
        }
        if (secondLeadSpinner != null) {
            secondLeadSpinner.setSelection(ReminderUi.indexOf(ReminderUi.SECOND_LEAD_VALUES, defaults.secondLeadMinutes));
        }
        if (followUpSpinner != null) {
            followUpSpinner.setSelection(ReminderUi.indexOf(ReminderUi.FOLLOW_UP_VALUES, defaults.followUpMinutes));
        }
    }

    private int selectedValue(Spinner spinner, int[] values) {
        int position = spinner == null ? 0 : spinner.getSelectedItemPosition();
        return position >= 0 && position < values.length ? values[position] : values[0];
    }

    private String repeatMode(int position) {
        if (position == 1) return Reminder.REPEAT_DAILY;
        if (position == 2) return Reminder.REPEAT_WEEKDAYS;
        if (position == 3) return Reminder.REPEAT_WEEKLY;
        return Reminder.REPEAT_ONCE;
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
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(16), dp(16), dp(16), dp(16));
        layout.setBackground(rounded(Color.WHITE, BORDER, 1, 18));
        return layout;
    }

    private TextView label(String value) {
        return text(value, 13, true, MUTED);
    }

    private EditText input(String hint, boolean multiline) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setHintTextColor(Color.rgb(148, 163, 184));
        input.setTextColor(TEXT);
        input.setTextSize(16);
        input.setPadding(dp(14), dp(12), dp(14), dp(12));
        input.setBackground(rounded(Color.rgb(248, 250, 252), BORDER, 1, 14));
        if (multiline) {
            input.setGravity(Gravity.TOP | Gravity.START);
        } else {
            input.setSingleLine(true);
        }
        return input;
    }

    private TextView pill(String value, int color) {
        TextView pill = text(value, 11, true, Color.WHITE);
        pill.setPadding(dp(9), dp(5), dp(9), dp(5));
        pill.setBackground(rounded(color, color, 1, 12));
        return pill;
    }

    private Button secondaryButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextColor(BLUE);
        button.setTextSize(13);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setBackground(rounded(Color.WHITE, BLUE, 1, 14));
        return button;
    }

    private Button primaryButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextColor(Color.WHITE);
        button.setTextSize(14);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setBackground(rounded(BLUE, BLUE_DARK, 1, 14));
        return button;
    }

    private void setQuickSaveEnabled(boolean enabled) {
        if (quickSaveButton == null) return;
        quickSaveButton.setEnabled(enabled);
        quickSaveButton.setAlpha(enabled ? 1f : 0.5f);
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
