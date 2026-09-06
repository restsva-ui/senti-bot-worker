package com.remindit.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;

public class MainActivity extends Activity {
    private static final int BLUE = Color.rgb(10, 132, 255);
    private static final int BLUE_DARK = Color.rgb(6, 105, 216);
    private static final int TEXT = Color.rgb(15, 23, 42);
    private static final int MUTED = Color.rgb(100, 116, 139);
    private static final int BG = Color.rgb(247, 250, 255);
    private static final int CARD = Color.WHITE;
    private static final int BORDER = Color.rgb(226, 232, 240);
    private static final int GREEN = Color.rgb(22, 163, 74);
    private static final int RED = Color.rgb(220, 38, 38);

    private LinearLayout reminderList;

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

        setContentView(buildUi());
        requestNotificationPermission();
    }

    @Override
    protected void onResume() {
        super.onResume();
        renderReminders();
    }

    private View buildUi() {
        ScrollView scrollView = new ScrollView(this);
        scrollView.setFillViewport(true);
        scrollView.setBackgroundColor(BG);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(18), dp(18), dp(18), dp(32));
        applySystemBarInsets(root);
        scrollView.addView(root);

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.ic_logo);
        header.addView(logo, new LinearLayout.LayoutParams(dp(58), dp(58)));

        LinearLayout titleBlock = new LinearLayout(this);
        titleBlock.setOrientation(LinearLayout.VERTICAL);
        titleBlock.addView(text("RemindIt", 30, true, TEXT));
        titleBlock.addView(text(tr("See it now. Remember it later.", "Побач зараз. Згадай вчасно."), 14, false, MUTED));

        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(0, -2, 1f);
        titleParams.setMargins(dp(10), 0, dp(8), 0);
        header.addView(titleBlock, titleParams);

        Button language = languageButton();
        header.addView(language, new LinearLayout.LayoutParams(dp(68), dp(44)));

        root.addView(header, margin(-1, -2, 0, 0, 0, 20));

        LinearLayout hero = card();
        TextView heroTitle = text(
                tr("Share anything. Remember at the right time.", "Поділись будь-чим. Згадай у потрібний момент."),
                20,
                true,
                TEXT
        );
        TextView heroBody = text(
                tr(
                        "From any app choose Share → RemindIt. Text and links are analyzed instantly; images use on-device OCR.",
                        "У будь-якому застосунку обери Поділитися → RemindIt. Текст і посилання аналізуються одразу, а зображення — локальним OCR."
                ),
                14,
                false,
                MUTED
        );
        hero.addView(heroTitle);
        hero.addView(heroBody, margin(-1, -2, 0, 8, 0, 14));

        Button add = primaryButton(tr("＋  Add reminder", "＋  Додати нагадування"));
        add.setOnClickListener(v -> startActivity(new Intent(this, AddReminderActivity.class)));
        hero.addView(add);
        root.addView(hero, margin(-1, -2, 0, 0, 0, 14));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !canExactAlarms()) {
            LinearLayout exactCard = card();
            exactCard.addView(text(
                    tr("Make reminders exact", "Точні нагадування"),
                    17,
                    true,
                    TEXT
            ));
            exactCard.addView(text(
                    tr(
                            "Android requires a one-time permission for exact reminder times.",
                            "Android потребує одноразового дозволу, щоб нагадування спрацьовували точно в заданий час."
                    ),
                    13,
                    false,
                    MUTED
            ), margin(-1, -2, 0, 5, 0, 10));

            Button exactButton = secondaryButton(tr("Allow exact reminders", "Дозволити точні нагадування"));
            exactButton.setOnClickListener(v -> openExactAlarmSettings());
            exactCard.addView(exactButton);
            root.addView(exactCard, margin(-1, -2, 0, 0, 0, 18));
        }

        LinearLayout heading = new LinearLayout(this);
        heading.setOrientation(LinearLayout.HORIZONTAL);
        heading.setGravity(Gravity.CENTER_VERTICAL);

        heading.addView(text(tr("Upcoming", "Майбутні"), 23, true, TEXT), new LinearLayout.LayoutParams(0, -2, 1f));
        heading.addView(text(tr("Offline • Local", "Офлайн • Локально"), 12, true, BLUE));
        root.addView(heading, margin(-1, -2, 0, 0, 0, 10));

        reminderList = new LinearLayout(this);
        reminderList.setOrientation(LinearLayout.VERTICAL);
        root.addView(reminderList);

        return scrollView;
    }

    private void renderReminders() {
        if (reminderList == null) return;

        reminderList.removeAllViews();
        List<Reminder> reminders = new ReminderDb(this).getUpcoming();

        if (reminders.isEmpty()) {
            LinearLayout empty = card();
            TextView emoji = text("🔔", 34, false, TEXT);
            emoji.setGravity(Gravity.CENTER);
            TextView emptyTitle = text(tr("Nothing to remember yet", "Поки що нагадувань немає"), 18, true, TEXT);
            emptyTitle.setGravity(Gravity.CENTER);
            TextView emptyBody = text(
                    tr(
                            "Create one here or share a screenshot, photo, link or text from another app.",
                            "Створи нагадування тут або поділись скріншотом, фото, посиланням чи текстом з іншого застосунку."
                    ),
                    13,
                    false,
                    MUTED
            );
            emptyBody.setGravity(Gravity.CENTER);

            empty.addView(emoji);
            empty.addView(emptyTitle, margin(-1, -2, 0, 6, 0, 5));
            empty.addView(emptyBody);
            reminderList.addView(empty);
            return;
        }

        SimpleDateFormat formatter = new SimpleDateFormat("EEE, dd MMM • HH:mm", LanguageManager.locale(this));

        for (Reminder reminder : reminders) {
            LinearLayout item = card();

            LinearLayout top = new LinearLayout(this);
            top.setOrientation(LinearLayout.HORIZONTAL);
            top.setGravity(Gravity.CENTER_VERTICAL);

            TextView icon = text(categoryEmoji(reminder.category), 25, false, TEXT);
            top.addView(icon, new LinearLayout.LayoutParams(dp(42), -2));

            LinearLayout titles = new LinearLayout(this);
            titles.setOrientation(LinearLayout.VERTICAL);
            titles.addView(text(reminder.title, 17, true, TEXT));
            titles.addView(text(formatter.format(new Date(reminder.remindAt)), 13, true, BLUE));
            top.addView(titles, new LinearLayout.LayoutParams(0, -2, 1f));
            item.addView(top);

            if (!TextUtils.isEmpty(reminder.body)) {
                item.addView(text(shortBody(reminder.body), 13, false, MUTED), margin(-1, -2, dp(42), 10, 0, 12));
            }

            LinearLayout actions = new LinearLayout(this);
            actions.setOrientation(LinearLayout.HORIZONTAL);

            Button done = smallButton(tr("✓ Done", "✓ Виконано"), GREEN);
            done.setOnClickListener(v -> {
                ReminderScheduler.cancel(this, reminder.id);
                new ReminderDb(this).markDone(reminder.id);
                renderReminders();
            });

            Button delete = smallButton(tr("Delete", "Видалити"), RED);
            delete.setOnClickListener(v -> {
                ReminderScheduler.cancel(this, reminder.id);
                new ReminderDb(this).delete(reminder.id);
                renderReminders();
            });

            actions.addView(done, new LinearLayout.LayoutParams(0, dp(44), 1f));
            View spacer = new View(this);
            actions.addView(spacer, new LinearLayout.LayoutParams(dp(8), 1));
            actions.addView(delete, new LinearLayout.LayoutParams(0, dp(44), 1f));
            item.addView(actions);
            reminderList.addView(item, margin(-1, -2, 0, 0, 0, 10));
        }
    }

    private Button languageButton() {
        Button button = baseButton("🌐 " + (LanguageManager.isUkrainian(this) ? "UA" : "EN"));
        button.setTextSize(12);
        button.setTextColor(BLUE);
        button.setMinHeight(0);
        button.setMinWidth(0);
        button.setPadding(dp(6), 0, dp(6), 0);
        button.setBackground(rounded(Color.WHITE, BLUE, 1, 14));
        button.setOnClickListener(v -> showLanguageMenu(button));
        return button;
    }

    private void showLanguageMenu(View anchor) {
        PopupMenu menu = new PopupMenu(this, anchor);
        menu.getMenu().add("Українська");
        menu.getMenu().add("English");
        menu.setOnMenuItemClickListener(item -> {
            String chosen = item.getTitle().toString().startsWith("Укра") ? "uk" : "en";
            if (!chosen.equals(LanguageManager.getLanguage(this))) {
                LanguageManager.setLanguage(this, chosen);
                recreate();
            }
            return true;
        });
        menu.show();
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

    private String shortBody(String body) {
        String clean = body.replace('\n', ' ').trim();
        return clean.length() > 140 ? clean.substring(0, 137) + "…" : clean;
    }

    private String categoryEmoji(String category) {
        if ("Travel".equals(category)) return "✈️";
        if ("Shopping".equals(category)) return "🛍️";
        if ("Bills".equals(category)) return "💳";
        if ("Work".equals(category)) return "💼";
        return "🔔";
    }

    private boolean canExactAlarms() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager manager = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
        return manager.canScheduleExactAlarms();
    }

    private void openExactAlarmSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return;
        try {
            Intent intent = new Intent(
                    Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    Uri.parse("package:" + getPackageName())
            );
            startActivity(intent);
        } catch (Exception e) {
            Toast.makeText(
                    this,
                    tr("Open Special app access → Alarms & reminders", "Відкрий Спеціальний доступ → Будильники й нагадування"),
                    Toast.LENGTH_LONG
            ).show();
        }
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
        layout.setBackground(rounded(CARD, BORDER, 1, 18));
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
        button.setBackground(rounded(Color.WHITE, BLUE, 1, 16));
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
        button.setTextSize(15);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setMinHeight(dp(50));
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
