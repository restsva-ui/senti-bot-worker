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
    private static final int CARD = Color.WHITE;
    private static final int SMART_BG = Color.rgb(255, 251, 235);

    private EditText titleInput;
    private EditText bodyInput;
    private EditText goalInput;
    private Spinner categorySpinner;
    private TextView dateValue;
    private TextView timeValue;
    private TextView sourceBadge;
    private TextView smartHint;

    private final Calendar selected = Calendar.getInstance();
    private String sourceType = "manual";
    private String imagePath = null;
    private String intentType = "remember";

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

        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(horizontal, normalTop + bars.top, horizontal, normalBottom + bars.bottom);
            return windowInsets;
        });

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);

        Button back = new Button(this);
        back.setText("‹");
        back.setTextSize(30);
        back.setTextColor(TEXT);
        back.setBackgroundColor(Color.TRANSPARENT);
        back.setMinWidth(dp(46));
        back.setOnClickListener(v -> finish());
        header.addView(back, new LinearLayout.LayoutParams(dp(46), dp(52)));

        LinearLayout titleBlock = new LinearLayout(this);
        titleBlock.setOrientation(LinearLayout.VERTICAL);
        titleBlock.addView(text(LanguageManager.pick(this, "Нове нагадування", "New reminder"), 25, true, TEXT));
        titleBlock.addView(text(
                LanguageManager.pick(this, "Збережи зараз. Згадай вчасно.", "Save it now. Remember it later."),
                13, false, MUTED));
        header.addView(titleBlock, new LinearLayout.LayoutParams(0, -2, 1f));

        Button language = secondaryButton("🌐 " + (LanguageManager.isUk(this) ? "UA" : "EN"));
        language.setTextSize(12);
        language.setOnClickListener(v -> showLanguagePicker());
        header.addView(language, new LinearLayout.LayoutParams(dp(82), dp(46)));

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
        sourceRow.addView(text(
                LanguageManager.pick(this, "  Локально • приватно", "  On-device • private"),
                12, true, MUTED));
        sourceCard.addView(sourceRow);

        smartHint = text(
                LanguageManager.pick(this,
                        "Поділись скріншотом, фото, посиланням або текстом — RemindIt спробує сформувати коротку суть.",
                        "Share a screenshot, photo, link or text and RemindIt will try to form a short reminder meaning."),
                13, false, MUTED);
        sourceCard.addView(smartHint, margin(-1, -2, 0, 9, 0, 0));
        root.addView(sourceCard, margin(-1, -2, 0, 0, 0, 12));

        LinearLayout essenceCard = card();
        essenceCard.setBackground(rounded(SMART_BG, YELLOW, 1, 18));
        essenceCard.addView(text(
                "✨ " + LanguageManager.pick(this, "Суть нагадування", "Reminder meaning"),
                17, true, TEXT));
        goalInput = input(
                LanguageManager.pick(this, "Наприклад: відповісти, оплатити, переглянути, не пропустити…", "For example: reply, pay, review, don't miss…"),
                true);
        goalInput.setMinLines(2);
        goalInput.setMaxLines(4);
        essenceCard.addView(goalInput, margin(-1, dp(88), 0, 10, 0, 0));
        root.addView(essenceCard, margin(-1, -2, 0, 0, 0, 12));

        LinearLayout details = card();
        details.addView(label(LanguageManager.pick(this, "Назва", "Title")));
        titleInput = input(LanguageManager.pick(this, "Про що нагадати?", "What should I remind you about?"), false);
        details.addView(titleInput, margin(-1, dp(56), 0, 6, 0, 14));

        details.addView(label(LanguageManager.pick(this, "Деталі", "Details")));
        bodyInput = input(
                LanguageManager.pick(this, "Текст, посилання або примітка…", "Text, link, or note…"),
                true);
        details.addView(bodyInput, margin(-1, dp(132), 0, 6, 0, 10));

        final String analyzeLabel = LanguageManager.pick(this, "✨ Сформувати суть", "✨ Generate meaning");
        Button analyzeButton = secondaryButton(analyzeLabel);
        analyzeButton.setClickable(true);
        analyzeButton.setFocusable(true);
        analyzeButton.setOnClickListener(v -> {
            v.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
            String source = (titleInput.getText().toString() + "\n" + bodyInput.getText().toString()).trim();
            if (source.isEmpty()) {
                Toast.makeText(this,
                        LanguageManager.pick(this, "Спочатку додай текст або назву", "Add some text or a title first"),
                        Toast.LENGTH_SHORT).show();
                return;
            }
            applySmartSuggestions(source);
            analyzeButton.setText(LanguageManager.pick(this, "✓ Суть оновлено", "✓ Meaning updated"));
            analyzeButton.postDelayed(() -> analyzeButton.setText(analyzeLabel), 1200);
            Toast.makeText(this,
                    LanguageManager.pick(this, "Суть нагадування оновлено", "Reminder meaning updated"),
                    Toast.LENGTH_SHORT).show();
        });
        details.addView(analyzeButton, margin(-1, dp(50), 0, 0, 0, 14));

        details.addView(label(LanguageManager.pick(this, "Категорія", "Category")));
        categorySpinner = new Spinner(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(
                this, android.R.layout.simple_spinner_item, LanguageManager.categories(this));
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        categorySpinner.setAdapter(adapter);
        categorySpinner.setPadding(dp(12), 0, dp(12), 0);
        categorySpinner.setBackground(rounded(Color.rgb(248, 250, 252), BORDER, 1, 14));
        details.addView(categorySpinner, margin(-1, dp(54), 0, 6, 0, 0));
        root.addView(details, margin(-1, -2, 0, 0, 0, 12));

        LinearLayout when = card();
        when.addView(text(LanguageManager.pick(this, "Коли нагадати?", "When should I remind you?"), 18, true, TEXT));
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
        root.addView(when, margin(-1, -2, 0, 0, 0, 14));

        Button saveButton = new Button(this);
        saveButton.setText(LanguageManager.pick(this, "Зберегти нагадування", "Save reminder"));
        saveButton.setAllCaps(false);
        saveButton.setTextSize(17);
        saveButton.setTypeface(Typeface.DEFAULT_BOLD);
        saveButton.setTextColor(Color.WHITE);
        saveButton.setBackground(rounded(BLUE, BLUE_DARK, 1, 18));
        saveButton.setOnClickListener(v -> saveReminder());
        root.addView(saveButton, new LinearLayout.LayoutParams(-1, dp(58)));

        return scroll;
    }

    private void handleIncoming(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String type = intent.getType();

        if (type != null && type.startsWith("image/")) {
            sourceType = "image";
            sourceBadge.setText(LanguageManager.pick(this, "ЗОБРАЖЕННЯ • OCR", "IMAGE • OCR"));
            sourceBadge.setBackground(rounded(YELLOW, YELLOW, 1, 12));
            sourceBadge.setTextColor(TEXT);
            smartHint.setText(LanguageManager.pick(this,
                    "Читаю зображення. Українська OCR-модель після першого завантаження працює локально.",
                    "Reading the image on this device…"));

            Uri uri = readSharedUri(intent);
            if (uri == null) {
                smartHint.setText(LanguageManager.pick(this, "Не вдалося відкрити зображення.", "Could not read the shared image."));
                return;
            }

            OcrHelper.recognize(this, uri, new OcrHelper.Callback() {
                @Override
                public void onSuccess(String recognizedText) {
                    if (recognizedText.trim().isEmpty()) {
                        smartHint.setText(LanguageManager.pick(AddReminderActivity.this,
                                "Текст не знайдено. Нагадування можна заповнити вручну.",
                                "No text found. You can still create the reminder manually."));
                        return;
                    }
                    bodyInput.setText(recognizedText);
                    applySmartSuggestions(recognizedText);
                }

                @Override
                public void onError(Exception error) {
                    smartHint.setText(LanguageManager.pick(AddReminderActivity.this,
                            "Не вдалося прочитати текст. Якщо це перший запуск українського OCR — перевір інтернет і поділись зображенням ще раз.",
                            "OCR could not read this image. Add the reminder manually."));
                }
            });
            return;
        }

        sourceType = "text";
        sourceBadge.setText(LanguageManager.pick(this, "ПОДІЛЕНО", "SHARED"));
        String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (sharedText == null) sharedText = "";
        bodyInput.setText(sharedText);
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

        ReminderIntentAnalyzer.Result analysis = ReminderIntentAnalyzer.analyze(this, text, sourceType);
        intentType = analysis.intentType;
        titleInput.setText(analysis.title);
        goalInput.setText(analysis.goal);
        setCategory(analysis.categoryKey);
        smartHint.setText(LanguageManager.pick(this,
                "Суть сформовано. Перевір текст і дату — їх можна відредагувати перед збереженням.",
                "Meaning generated. Check the text and date; both can be edited before saving."));
    }

    private void saveReminder() {
        String title = titleInput.getText().toString().trim();
        String body = bodyInput.getText().toString().trim();
        String goal = goalInput.getText().toString().trim();

        if (TextUtils.isEmpty(title)) {
            Toast.makeText(this, LanguageManager.pick(this, "Додай назву", "Add a title"), Toast.LENGTH_SHORT).show();
            return;
        }
        if (TextUtils.isEmpty(goal)) {
            ReminderIntentAnalyzer.Result analysis = ReminderIntentAnalyzer.analyze(
                    this, body.length() > 0 ? body : title, sourceType);
            goal = analysis.goal;
            intentType = analysis.intentType;
        }
        if (selected.getTimeInMillis() <= System.currentTimeMillis()) {
            Toast.makeText(this,
                    LanguageManager.pick(this, "Обери час у майбутньому", "Choose a time in the future"),
                    Toast.LENGTH_SHORT).show();
            return;
        }

        Reminder reminder = new Reminder();
        reminder.title = title;
        reminder.body = body;
        reminder.goal = goal;
        reminder.intentType = intentType;
        reminder.category = LanguageManager.categoryKeyFromDisplay(String.valueOf(categorySpinner.getSelectedItem()));
        reminder.sourceType = sourceType;
        reminder.imagePath = imagePath;
        reminder.remindAt = selected.getTimeInMillis();
        reminder.createdAt = System.currentTimeMillis();
        reminder.done = false;

        ReminderDb db = new ReminderDb(this);
        reminder.id = db.insert(reminder);
        boolean exact = ReminderScheduler.schedule(this, reminder);

        if (!exact && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Toast.makeText(this,
                    LanguageManager.pick(this,
                            "Нагадування збережено. Дозволь точні нагадування — після дозволу таймер буде поставлено автоматично.",
                            "Reminder saved. Allow exact alarms and it will be scheduled automatically."),
                    Toast.LENGTH_LONG).show();
            openExactAlarmSettings();
            finish();
            return;
        }

        Toast.makeText(this,
                LanguageManager.pick(this, "Нагадування поставлено на точний час", "Reminder scheduled for the exact time"),
                Toast.LENGTH_SHORT).show();
        finish();
    }

    private void openExactAlarmSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return;
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    Uri.parse("package:" + getPackageName())));
        } catch (Exception e) {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getPackageName())));
        }
    }

    private void showLanguagePicker() {
        String[] labels = {"Українська", "English"};
        int checked = LanguageManager.isUk(this) ? 0 : 1;
        new AlertDialog.Builder(this)
                .setTitle(LanguageManager.pick(this, "Мова", "Language"))
                .setSingleChoiceItems(labels, checked, (dialog, which) -> {
                    LanguageManager.set(this, which == 0 ? LanguageManager.UK : LanguageManager.EN);
                    dialog.dismiss();
                    recreate();
                })
                .show();
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
        if (dateValue != null) {
            dateValue.setText(new SimpleDateFormat("dd.MM.yyyy", Locale.getDefault()).format(selected.getTime()));
        }
        if (timeValue != null) {
            timeValue.setText(new SimpleDateFormat("HH:mm", Locale.getDefault()).format(selected.getTime()));
        }
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
        layout.setBackground(rounded(CARD, BORDER, 1, 18));
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
            input.setMinLines(4);
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
