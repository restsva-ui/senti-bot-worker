package com.remindit.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
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
import android.widget.Button;
import android.widget.ImageView;
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
import java.util.Locale;

public class MainActivity extends Activity {
    private static final int BLUE = Color.rgb(10, 132, 255);
    private static final int BLUE_DARK = Color.rgb(6, 105, 216);
    private static final int YELLOW = Color.rgb(255, 200, 61);
    private static final int TEXT = Color.rgb(15, 23, 42);
    private static final int MUTED = Color.rgb(100, 116, 139);
    private static final int BG = Color.rgb(247, 250, 255);
    private static final int CARD = Color.WHITE;
    private static final int BORDER = Color.rgb(226, 232, 240);
    private static final int GREEN = Color.rgb(22, 163, 74);
    private static final int RED = Color.rgb(220, 38, 38);
    private static final int AMBER_BG = Color.rgb(255, 251, 235);

    private LinearLayout reminderList;
    private View exactCard;

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
        updateExactCard();
        renderReminders();
    }

    private View buildUi() {
        ScrollView scrollView = new ScrollView(this);
        scrollView.setFillViewport(true);
        scrollView.setBackgroundColor(BG);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        final int horizontal = dp(18);
        final int normalTop = dp(18);
        final int normalBottom = dp(36);
        root.setPadding(horizontal, normalTop, horizontal, normalBottom);
        scrollView.addView(root);

        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(horizontal, normalTop + bars.top, horizontal, normalBottom + bars.bottom);
            return windowInsets;
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
        titleBlock.addView(text(
                LanguageManager.pick(this, "Побач зараз. Згадай вчасно.", "See it now. Remember it later."),
                14, false, MUTED));

        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(0, -2, 1f);
        titleParams.setMargins(dp(10), 0, dp(8), 0);
        header.addView(titleBlock, titleParams);

        Button language = secondaryButton("🌐 " + (LanguageManager.isUk(this) ? "UA" : "EN"));
        language.setTextSize(13);
        language.setMinWidth(dp(84));
        language.setOnClickListener(v -> showLanguagePicker());
        header.addView(language, new LinearLayout.LayoutParams(dp(96), dp(48)));

        root.addView(header, margin(-1, -2, 0, 0, 0, 20));

        LinearLayout hero = card();
        hero.addView(text(
                LanguageManager.pick(this,
                        "Поділись будь-чим. Згадай у потрібний момент.",
                        "Share anything. Remember at the right time."),
                20, true, TEXT));
        hero.addView(text(
                LanguageManager.pick(this,
                        "У будь-якому застосунку обери Поділитися → RemindIt. Текст і посилання аналізуються одразу, а зображення — локальним OCR.",
                        "From any app choose Share → RemindIt. Text and links are analyzed instantly; images use on-device OCR."),
                14, false, MUTED), margin(-1, -2, 0, 8, 0, 14));

        Button add = primaryButton(LanguageManager.pick(this, "＋  Додати нагадування", "＋  Add reminder"));
        add.setOnClickListener(v -> startActivity(new Intent(this, AddReminderActivity.class)));
        hero.addView(add);
        root.addView(hero, margin(-1, -2, 0, 0, 0, 14));

        exactCard = buildExactPermissionCard();
        root.addView(exactCard, margin(-1, -2, 0, 0, 0, 12));

        if (isXiaomiFamily()) {
            root.addView(buildHyperOsCard(), margin(-1, -2, 0, 0, 0, 18));
        }

        LinearLayout heading = new LinearLayout(this);
        heading.setOrientation(LinearLayout.HORIZONTAL);
        heading.setGravity(Gravity.CENTER_VERTICAL);
        heading.addView(text(LanguageManager.pick(this, "Майбутні", "Upcoming"), 23, true, TEXT),
                new LinearLayout.LayoutParams(0, -2, 1f));

        TextView local = text(LanguageManager.pick(this, "Приватно • Локально", "Private • Local"), 12, true, BLUE);
        heading.addView(local);
        root.addView(heading, margin(-1, -2, 0, 0, 0, 10));

        reminderList = new LinearLayout(this);
        reminderList.setOrientation(LinearLayout.VERTICAL);
        root.addView(reminderList);
        return scrollView;
    }

    private View buildExactPermissionCard() {
        LinearLayout card = card();
        card.setBackground(rounded(AMBER_BG, YELLOW, 1, 18));
        card.addView(text(
                LanguageManager.pick(this, "Точний час нагадувань", "Exact reminder timing"),
                17, true, TEXT));
        card.addView(text(
                LanguageManager.pick(this,
                        "RemindIt використовує системний режим AlarmClock, щоб будити телефон у вибраний час навіть у режимі сну.",
                        "RemindIt uses Android's AlarmClock mode so the phone can wake at the selected time even while idle."),
                13, false, MUTED), margin(-1, -2, 0, 5, 0, 10));
        Button exactButton = secondaryButton(LanguageManager.pick(this, "Дозволити точні нагадування", "Allow exact reminders"));
        exactButton.setOnClickListener(v -> openExactAlarmSettings());
        card.addView(exactButton);
        return card;
    }

    private View buildHyperOsCard() {
        LinearLayout card = card();
        card.setBackground(rounded(Color.rgb(239, 246, 255), BLUE, 1, 18));
        card.addView(text(
                LanguageManager.pick(this, "HyperOS: робота на заблокованому екрані", "HyperOS: locked-screen reliability"),
                16, true, TEXT));
        card.addView(text(
                LanguageManager.pick(this,
                        "На Xiaomi/Redmi/POCO HyperOS може окремо обмежувати фонову роботу. У налаштуваннях RemindIt увімкни Автозапуск, сповіщення на екрані блокування та для батареї — Без обмежень.",
                        "On Xiaomi/Redmi/POCO, HyperOS can separately restrict background work. In RemindIt app settings enable Autostart, lock-screen notifications and No restrictions for battery."),
                13, false, MUTED), margin(-1, -2, 0, 6, 0, 10));
        Button settingsButton = secondaryButton(LanguageManager.pick(this, "Відкрити налаштування RemindIt", "Open RemindIt settings"));
        settingsButton.setOnClickListener(v -> openAppSettings());
        card.addView(settingsButton);
        return card;
    }

    private void updateExactCard() {
        if (exactCard != null) {
            exactCard.setVisibility(ReminderScheduler.canScheduleExactly(this) ? View.GONE : View.VISIBLE);
        }
    }

    private void renderReminders() {
        if (reminderList == null) return;
        reminderList.removeAllViews();
        List<Reminder> reminders = new ReminderDb(this).getUpcoming();

        if (reminders.isEmpty()) {
            LinearLayout empty = card();
            TextView emoji = text("🔔", 34, false, TEXT);
            emoji.setGravity(Gravity.CENTER);
            TextView emptyTitle = text(
                    LanguageManager.pick(this, "Поки нічого не потрібно пам’ятати", "Nothing to remember yet"),
                    18, true, TEXT);
            emptyTitle.setGravity(Gravity.CENTER);
            TextView emptyBody = text(
                    LanguageManager.pick(this,
                            "Створи нагадування тут або поділись скріншотом, фото, посиланням чи текстом з іншого застосунку.",
                            "Create one here or share a screenshot, photo, link or text from another app."),
                    13, false, MUTED);
            emptyBody.setGravity(Gravity.CENTER);
            empty.addView(emoji);
            empty.addView(emptyTitle, margin(-1, -2, 0, 6, 0, 5));
            empty.addView(emptyBody);
            reminderList.addView(empty);
            return;
        }

        SimpleDateFormat formatter = new SimpleDateFormat("EEE, dd MMM • HH:mm", LanguageManager.displayLocale(this));
        long now = System.currentTimeMillis();

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

            int timeColor = reminder.remindAt < now ? RED : BLUE;
            String timeText = formatter.format(new Date(reminder.remindAt));
            if (reminder.remindAt < now) {
                timeText = LanguageManager.pick(this, "Прострочено • ", "Overdue • ") + timeText;
            }
            titles.addView(text(timeText, 13, true, timeColor));
            top.addView(titles, new LinearLayout.LayoutParams(0, -2, 1f));
            item.addView(top);

            if (!TextUtils.isEmpty(reminder.goal)) {
                TextView goal = text("✨ " + reminder.goal, 14, true, TEXT);
                goal.setPadding(dp(12), dp(10), dp(12), dp(10));
                goal.setBackground(rounded(Color.rgb(255, 251, 235), YELLOW, 1, 12));
                item.addView(goal, margin(-1, -2, dp(42), 8, 0, 8));
            }

            if (!TextUtils.isEmpty(reminder.body)) {
                item.addView(text(shortBody(reminder.body), 13, false, MUTED),
                        margin(-1, -2, dp(42), 2, 0, 12));
            }

            LinearLayout actions = new LinearLayout(this);
            actions.setOrientation(LinearLayout.HORIZONTAL);
            Button done = smallButton(LanguageManager.pick(this, "✓ Виконано", "✓ Done"), GREEN);
            done.setOnClickListener(v -> {
                ReminderScheduler.cancel(this, reminder.id);
                new ReminderDb(this).markDone(reminder.id);
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

    private String shortBody(String body) {
        String clean = body.replace('\n', ' ').trim();
        return clean.length() > 170 ? clean.substring(0, 167) + "…" : clean;
    }

    private String categoryEmoji(String category) {
        if ("Travel".equals(category)) return "✈️";
        if ("Shopping".equals(category)) return "🛍️";
        if ("Bills".equals(category)) return "💳";
        if ("Work".equals(category)) return "💼";
        if ("Other".equals(category)) return "🧠";
        return "🔔";
    }

    private boolean isXiaomiFamily() {
        String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase(Locale.ROOT);
        String brand = Build.BRAND == null ? "" : Build.BRAND.toLowerCase(Locale.ROOT);
        return manufacturer.contains("xiaomi") || brand.contains("xiaomi")
                || brand.contains("redmi") || brand.contains("poco");
    }

    private void openExactAlarmSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return;
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    Uri.parse("package:" + getPackageName())));
        } catch (Exception e) {
            openAppSettings();
        }
    }

    private void openAppSettings() {
        startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getPackageName())));
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
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
