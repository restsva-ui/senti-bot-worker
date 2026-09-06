package com.remindit.app;

import android.app.Activity;
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
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.Calendar;

public class AddReminderActivity extends Activity {
    private static final int BLUE = Color.rgb(10, 132, 255);
    private static final int BLUE_DARK = Color.rgb(6, 105, 216);
    private static final int YELLOW = Color.rgb(255, 200, 61);
    private static final int TEXT = Color.rgb(15, 23, 42);
    private static final int MUTED = Color.rgb(100, 116, 139);
    private static final int BG = Color.rgb(247, 250, 255);
    private static final int BORDER = Color.rgb(226, 232, 240);
    private static final int CARD = Color.WHITE;

    private static final String[] CATEGORY_KEYS = {"Personal", "Shopping", "Travel", "Work", "Bills", "Other"};

    private EditText titleInput;
    private EditText bodyInput;
    private Spinner categorySpinner;
    private TextView dateValue;
    private TextView timeValue;
    private TextView sourceBadge;
    private TextView smartHint;
    private Button saveButton;

    private final Calendar selected = Calendar.getInstance();
    private String sourceType = "manual";
    private String imagePath = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(Color.WHITE);
        int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        getWindow().getDecorView().setSystemUiVisibility(flags);

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
        root.setPadding(dp(18), dp(18), dp(18), dp(32));
        applySystemBarInsets(root);
        scroll.addView(root);

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);

        Button back = new Button(this);
        back.setText("‹");
        back.setTextSize(30);
        back.setTextColor(TEXT);
        back.setBackgroundColor(Color.TRANSPARENT);
        back.setMinWidth(dp(50));
        back.setOnClickListener(v -> finish());
        header.addView(back, new LinearLayout.LayoutParams(dp(50), dp(52)));

        LinearLayout titleBlock = new LinearLayout(this);
        titleBlock.setOrientation(LinearLayout.VERTICAL);
        titleBlock.addView(text(tr("New reminder", "Нове нагадування"), 25, true, TEXT));
        titleBlock.addView(text(tr("Save it now. Remember it later.", "Збережи зараз. Згадай вчасно."), 13, false, MUTED));
        header.addView(titleBlock, new LinearLayout.LayoutParams(0, -2, 1f));

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.ic_logo);
        header.addView(logo, new LinearLayout.LayoutParams(dp(50), dp(50)));

        root.addView(header, margin(-1, -2, 0, 0, 0, 18));

        LinearLayout sourceCard = card();
        LinearLayout sourceRow = new LinearLayout(this);
        sourceRow.setOrientation(LinearLayout.HORIZONTAL);
        sourceRow.setGravity(Gravity.CENTER_VERTICAL);

        sourceBadge = pill(tr("MANUAL", "ВРУЧНУ"), BLUE);
        sourceRow.addView(sourceBadge);
        sourceRow.addView(text(tr("  On-device • private", "  На пристрої • приватно"), 12, true, MUTED));
        sourceCard.addView(sourceRow);

        smartHint = text(
                tr(
                        "Share a screenshot, photo, link or text to let RemindIt suggest the date and category automatically.",
                        "Поділись скріншотом, фото, посиланням або текстом — RemindIt автоматично запропонує дату й категорію."
                ),
                13,
                false,
                MUTED
        );
        sourceCard.addView(smartHint, margin(-1, -2, 0, 9, 0, 0));
        root.addView(sourceCard, margin(-1, -2, 0, 0, 0, 12));

        LinearLayout details = card();
        details.addView(label(tr("Title", "Назва")));

        titleInput = input(tr("What should I remind you about?", "Про що тобі нагадати?"), false);
        details.addView(titleInput, margin(-1, dp(56), 0, 6, 0, 14));

        details.addView(label(tr("Details", "Деталі")));
        bodyInput = input(tr("Paste text, a link, or add a note…", "Встав текст, посилання або додай нотатку…"), true);
        details.addView(bodyInput, margin(-1, dp(132), 0, 6, 0, 14));

        details.addView(label(tr("Category", "Категорія")));
        categorySpinner = new Spinner(this);
        String[] categories = LanguageManager.isUkrainian(this)
                ? new String[]{"Особисте", "Покупки", "Подорожі", "Робота", "Платежі", "Інше"}
                : new String[]{"Personal", "Shopping", "Travel", "Work", "Bills", "Other"};
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, categories);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        categorySpinner.setAdapter(adapter);
        categorySpinner.setPadding(dp(12), 0, dp(12), 0);
        categorySpinner.setBackground(rounded(Color.rgb(248, 250, 252), BORDER, 1, 14));
        details.addView(categorySpinner, margin(-1, dp(54), 0, 6, 0, 0));
        root.addView(details, margin(-1, -2, 0, 0, 0, 12));

        LinearLayout when = card();
        when.addView(text(tr("When should I remind you?", "Коли нагадати?"), 18, true, TEXT));

        LinearLayout dateTime = new LinearLayout(this);
        dateTime.setOrientation(LinearLayout.HORIZONTAL);

        LinearLayout dateBlock = valueBlock(tr("Date", "Дата"));
        dateValue = (TextView) dateBlock.getChildAt(1);
        dateValue.setOnClickListener(v -> pickDate());

        LinearLayout timeBlock = valueBlock(tr("Time", "Час"));
        timeValue = (TextView) timeBlock.getChildAt(1);
        timeValue.setOnClickListener(v -> pickTime());

        dateTime.addView(dateBlock, new LinearLayout.LayoutParams(0, -2, 1f));
        View gap = new View(this);
        dateTime.addView(gap, new LinearLayout.LayoutParams(dp(10), 1));
        dateTime.addView(timeBlock, new LinearLayout.LayoutParams(0, -2, 1f));
        when.addView(dateTime, margin(-1, -2, 0, 12, 0, 0));
        root.addView(when, margin(-1, -2, 0, 0, 0, 14));

        saveButton = new Button(this);
        saveButton.setText(tr("Save reminder", "Зберегти нагадування"));
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
            sourceBadge.setText(tr("IMAGE • OCR", "ЗОБРАЖЕННЯ • OCR"));
            sourceBadge.setBackground(rounded(YELLOW, YELLOW, 1, 12));
            sourceBadge.setTextColor(TEXT);
            smartHint.setText(tr("Reading text from the image on this phone…", "Розпізнаю текст із зображення на цьому телефоні…"));

            Uri uri = readSharedUri(intent);
            if (uri == null) {
                smartHint.setText(tr("Could not read the shared image.", "Не вдалося прочитати передане зображення."));
                return;
            }

            OcrHelper.recognize(this, uri, new OcrHelper.Callback() {
                @Override
                public void onSuccess(String recognizedText) {
                    smartHint.setText(
                            recognizedText.trim().isEmpty()
                                    ? tr("No text found. You can still create the reminder manually.", "Текст не знайдено. Нагадування можна створити вручну.")
                                    : tr("Text found. RemindIt suggested a date and category.", "Текст знайдено. RemindIt запропонував дату й категорію.")
                    );
                    bodyInput.setText(recognizedText);
                    titleInput.setText(inferTitle(recognizedText, tr("Image reminder", "Нагадування із зображення")));
                    applySmartSuggestions(recognizedText);
                }

                @Override
                public void onError(Exception error) {
                    smartHint.setText(tr("OCR could not read this image. Add the reminder manually.", "OCR не зміг прочитати зображення. Додай нагадування вручну."));
                }
            });
            return;
        }

        sourceType = "text";
        sourceBadge.setText(tr("SHARED", "ПОДІЛЕНО"));
        String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (sharedText == null) sharedText = "";
        bodyInput.setText(sharedText);
        titleInput.setText(inferTitle(sharedText, tr("Shared reminder", "Нагадування з переданого")));
        applySmartSuggestions(sharedText);
        smartHint.setText(tr("Shared content received. Date and category suggestions are ready.", "Вміст отримано. Пропозиції дати й категорії готові."));
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
        setCategory(DateDetector.inferCategory(text));
    }

    private String inferTitle(String raw, String fallback) {
        if (raw == null || raw.trim().isEmpty()) return fallback;
        String clean = raw.trim().replace('\r', ' ');
        String firstLine = clean.split("\\n", 2)[0].trim();
        if (firstLine.length() > 55) firstLine = firstLine.substring(0, 52) + "…";
        if (firstLine.startsWith("http://") || firstLine.startsWith("https://")) {
            return tr("Open saved link", "Відкрити збережене посилання");
        }
        return firstLine.isEmpty() ? fallback : firstLine;
    }

    private void saveReminder() {
        String title = titleInput.getText().toString().trim();
        String body = bodyInput.getText().toString().trim();

        if (TextUtils.isEmpty(title)) {
            Toast.makeText(this, tr("Add a title", "Додай назву"), Toast.LENGTH_SHORT).show();
            return;
        }
        if (selected.getTimeInMillis() <= System.currentTimeMillis()) {
            Toast.makeText(this, tr("Choose a time in the future", "Обери майбутній час"), Toast.LENGTH_SHORT).show();
            return;
        }

        Reminder reminder = new Reminder();
        reminder.title = title;
        reminder.body = body;
        int categoryIndex = categorySpinner.getSelectedItemPosition();
        reminder.category = CATEGORY_KEYS[Math.max(0, Math.min(categoryIndex, CATEGORY_KEYS.length - 1))];
        reminder.sourceType = sourceType;
        reminder.imagePath = imagePath;
        reminder.remindAt = selected.getTimeInMillis();
        reminder.createdAt = System.currentTimeMillis();
        reminder.done = false;

        ReminderDb db = new ReminderDb(this);
        reminder.id = db.insert(reminder);
        ReminderScheduler.schedule(this, reminder);

        Toast.makeText(this, tr("Reminder saved", "Нагадування збережено"), Toast.LENGTH_SHORT).show();
        finish();
    }

    private void setCategory(String category) {
        for (int i = 0; i < CATEGORY_KEYS.length; i++) {
            if (CATEGORY_KEYS[i].equals(category)) {
                categorySpinner.setSelection(i);
                return;
            }
        }
    }

    private void pickDate() {
        DatePickerDialog dialog = new DatePickerDialog(
                this,
                (view, year, month, day) -> {
                    selected.set(Calendar.YEAR, year);
                    selected.set(Calendar.MONTH, month);
                    selected.set(Calendar.DAY_OF_MONTH, day);
                    refreshDateTime();
                },
                selected.get(Calendar.YEAR),
                selected.get(Calendar.MONTH),
                selected.get(Calendar.DAY_OF_MONTH)
        );
        dialog.show();
    }

    private void pickTime() {
        TimePickerDialog dialog = new TimePickerDialog(
                this,
                (view, hour, minute) -> {
                    selected.set(Calendar.HOUR_OF_DAY, hour);
                    selected.set(Calendar.MINUTE, minute);
                    selected.set(Calendar.SECOND, 0);
                    selected.set(Calendar.MILLISECOND, 0);
                    refreshDateTime();
                },
                selected.get(Calendar.HOUR_OF_DAY),
                selected.get(Calendar.MINUTE),
                true
        );
        dialog.show();
    }

    private void refreshDateTime() {
        if (dateValue != null) {
            dateValue.setText(new SimpleDateFormat("dd.MM.yyyy", LanguageManager.locale(this)).format(selected.getTime()));
        }
        if (timeValue != null) {
            timeValue.setText(new SimpleDateFormat("HH:mm", LanguageManager.locale(this)).format(selected.getTime()));
        }
    }

    private void applySystemBarInsets(View root) {
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int top;
            int bottom;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                top = bars.top;
                bottom = bars.bottom;
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
            }
            v.setPadding(dp(18), dp(18) + top, dp(18), dp(32) + bottom);
            return insets;
        });
        root.requestApplyInsets();
    }

    private String tr(String english, String ukrainian) {
        return LanguageManager.text(this, english, ukrainian);
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
