package com.remindit.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

public class SettingsActivity extends Activity {
    private static final int BLUE = UiKit.INDIGO;
    private static final int GREEN = UiKit.GREEN;
    private static final int AMBER = UiKit.AMBER;
    private static final int TEXT = UiKit.TEXT;
    private static final int MUTED = UiKit.MUTED;
    private static final int BG = UiKit.BG;
    private static final int BORDER = UiKit.BORDER;

    private TextView languageValue;
    private TextView notificationStatus;
    private TextView exactStatus;
    private TextView batteryStatus;
    private TextView diagnosticStatus;
    private TextView readinessStatus;

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
        refreshStatuses();
    }

    private ScrollView buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        final int horizontal = dp(18);
        final int top = dp(16);
        final int bottom = dp(32);
        root.setPadding(horizontal, top, horizontal, bottom);
        scroll.addView(root);

        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(horizontal, top + bars.top, horizontal, bottom + bars.bottom);
            return insets;
        });

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);

        Button back = UiKit.iconButton(this, "‹");
        back.setContentDescription(LanguageManager.pick(this, "Назад", "Back"));
        back.setOnClickListener(v -> finish());
        header.addView(back, new LinearLayout.LayoutParams(dp(48), dp(48)));

        LinearLayout title = new LinearLayout(this);
        title.setOrientation(LinearLayout.VERTICAL);
        title.addView(text(LanguageManager.pick(this, "Налаштування", "Settings"), 26, true, TEXT));
        title.addView(text(LanguageManager.pick(this,
                "Надійність, мова й приватність", "Reliability, language & privacy"), 13, false, MUTED));
        header.addView(title, new LinearLayout.LayoutParams(0, -2, 1f));
        root.addView(header, margin(-1, -2, 0, 0, 0, 14));

        LinearLayout readiness = new LinearLayout(this);
        readiness.setOrientation(LinearLayout.VERTICAL);
        readiness.setPadding(dp(18), dp(18), dp(18), dp(18));
        readiness.setBackground(UiKit.gradient(this, UiKit.INDIGO, UiKit.VIOLET, 22));
        readiness.setElevation(dp(4));
        readiness.addView(text(LanguageManager.pick(this,
                "ГОТОВНІСТЬ REMINDIT", "REMINDIT READINESS"), 11, true, Color.rgb(224, 231, 255)));
        readinessStatus = text("", 20, true, Color.WHITE);
        readiness.addView(readinessStatus, margin(-1, -2, 0, 8, 0, 0));
        readiness.addView(text(LanguageManager.pick(this,
                "Для точного сигналу потрібні сповіщення, точні будильники та вільна фонова робота.",
                "Notifications, exact alarms and unrestricted background work keep alerts reliable."),
                13, false, Color.rgb(238, 242, 255)), margin(-1, -2, 0, 7, 0, 0));
        root.addView(readiness, margin(-1, -2, 0, 0, 0, 14));

        LinearLayout languageCard = card();
        languageCard.addView(sectionTitle("◎ " + LanguageManager.pick(this, "Мова", "Language")));
        languageValue = text("", 15, true, BLUE);
        languageCard.addView(languageValue, margin(-1, -2, 0, 5, 0, 10));
        Button languageButton = secondaryButton(LanguageManager.pick(this, "Змінити мову", "Change language"));
        languageButton.setOnClickListener(v -> showLanguagePicker());
        languageCard.addView(languageButton);
        root.addView(languageCard, margin(-1, -2, 0, 0, 0, 12));

        LinearLayout permissions = card();
        permissions.addView(sectionTitle("✓ " + LanguageManager.pick(this, "Дозволи", "Permissions")));

        notificationStatus = text("", 14, true, MUTED);
        permissions.addView(notificationStatus, margin(-1, -2, 0, 8, 0, 6));
        Button notifications = secondaryButton(LanguageManager.pick(this, "Дозволити сповіщення", "Allow notifications"));
        notifications.setOnClickListener(v -> requestNotifications());
        permissions.addView(notifications, margin(-1, dp(50), 0, 0, 0, 10));

        exactStatus = text("", 14, true, MUTED);
        permissions.addView(exactStatus, margin(-1, -2, 0, 2, 0, 6));
        Button exact = secondaryButton(LanguageManager.pick(this, "Дозволити точні нагадування", "Allow exact reminders"));
        exact.setOnClickListener(v -> openExactAlarmSettings());
        permissions.addView(exact, margin(-1, dp(50), 0, 0, 0, 10));

        Button channel = secondaryButton(LanguageManager.pick(this, "Сповіщення на екрані блокування", "Lock-screen notifications"));
        channel.setOnClickListener(v -> openNotificationSettings());
        permissions.addView(channel, margin(-1, dp(50), 0, 0, 0, 10));

        Button appSettings = secondaryButton(LanguageManager.pick(this, "Фонова робота / батарея / автозапуск", "Background / battery / autostart"));
        appSettings.setOnClickListener(v -> openAppSettings());
        permissions.addView(appSettings, new LinearLayout.LayoutParams(-1, dp(50)));
        root.addView(permissions, margin(-1, -2, 0, 0, 0, 12));

        LinearLayout diagnostics = card();
        diagnostics.addView(sectionTitle("◷ " + LanguageManager.pick(this, "Перевірка надійності", "Reliability check")));
        diagnostics.addView(text(LanguageManager.pick(this,
                "RemindIt створить точне тестове нагадування через 2 хвилини. Заблокуй екран і не відкривай застосунок.",
                "RemindIt will create an exact test reminder in 2 minutes. Lock the screen and leave the app closed."),
                13, false, MUTED), margin(-1, -2, 0, 6, 0, 8));
        batteryStatus = text("", 14, true, MUTED);
        diagnostics.addView(batteryStatus, margin(-1, -2, 0, 0, 0, 6));
        diagnosticStatus = text("", 14, true, MUTED);
        diagnostics.addView(diagnosticStatus, margin(-1, -2, 0, 0, 0, 10));
        Button testAlarm = primaryButton(LanguageManager.pick(this, "Перевірити через 2 хв", "Test in 2 minutes"));
        testAlarm.setOnClickListener(v -> runAlarmTest());
        diagnostics.addView(testAlarm);
        root.addView(diagnostics, margin(-1, -2, 0, 0, 0, 12));

        LinearLayout sound = card();
        sound.addView(sectionTitle("♫ " + LanguageManager.pick(this, "Звук RemindIt", "RemindIt sound")));
        sound.addView(text(
                LanguageManager.pick(this,
                        "Оригінальний короткий сигнал RemindIt: чотири м’які ноти, синтезовані самим застосунком.",
                        "An original short RemindIt chime: four gentle notes synthesized by the app."),
                13, false, MUTED), margin(-1, -2, 0, 6, 0, 10));
        Button preview = primaryButton(LanguageManager.pick(this, "▶ Прослухати звук", "▶ Preview sound"));
        preview.setOnClickListener(v -> ReminderSound.play());
        sound.addView(preview);
        root.addView(sound, margin(-1, -2, 0, 0, 0, 12));

        LinearLayout privacy = card();
        privacy.addView(sectionTitle("♢ " + LanguageManager.pick(this, "Приватність", "Privacy")));
        privacy.setBackground(rounded(Color.rgb(240, 253, 250), Color.rgb(153, 246, 228), 1, 22));
        privacy.addView(text(
                LanguageManager.pick(this,
                        "Фото, скріншоти, OCR і нагадування обробляються локально. Мовні моделі вже містяться у застосунку.",
                        "Images, screenshots, OCR and reminders are processed locally. Language models are bundled with the app."),
                13, false, MUTED), margin(-1, -2, 0, 6, 0, 10));
        Button fullPolicy = secondaryButton(LanguageManager.pick(this, "Відкрити повну політику", "Open full policy"));
        fullPolicy.setOnClickListener(v -> startActivity(new Intent(this, PrivacyPolicyActivity.class)));
        privacy.addView(fullPolicy);
        root.addView(privacy);

        return scroll;
    }

    private void refreshStatuses() {
        if (languageValue != null) {
            languageValue.setText(LanguageManager.isUk(this) ? "Українська" : "English");
        }
        boolean notifications = notificationsAllowed();
        if (notificationStatus != null) {
            notificationStatus.setText((notifications ? "✓ " : "! ") + LanguageManager.pick(this,
                    notifications ? "Сповіщення дозволені" : "Сповіщення не дозволені",
                    notifications ? "Notifications allowed" : "Notifications not allowed"));
            notificationStatus.setTextColor(notifications ? GREEN : AMBER);
        }
        boolean exact = ReminderScheduler.canScheduleExactly(this);
        if (exactStatus != null) {
            exactStatus.setText((exact ? "✓ " : "! ") + LanguageManager.pick(this,
                    exact ? "Точні нагадування дозволені" : "Точні нагадування не дозволені",
                    exact ? "Exact reminders allowed" : "Exact reminders not allowed"));
            exactStatus.setTextColor(exact ? GREEN : AMBER);
        }
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        boolean unrestricted = Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || power == null
                || power.isIgnoringBatteryOptimizations(getPackageName());
        if (batteryStatus != null) {
            batteryStatus.setText((unrestricted ? "✓ " : "! ") + LanguageManager.pick(this,
                    unrestricted ? "Батарея не обмежує RemindIt" : "Перевір фонову роботу й автозапуск",
                    unrestricted ? "Battery is not restricting RemindIt" : "Check background activity and autostart"));
            batteryStatus.setTextColor(unrestricted ? GREEN : AMBER);
        }
        if (readinessStatus != null) {
            int ready = (notifications ? 1 : 0) + (exact ? 1 : 0) + (unrestricted ? 1 : 0);
            readinessStatus.setText(ready == 3
                    ? LanguageManager.pick(this, "✓ Усе готово", "✓ All set")
                    : LanguageManager.pick(this, ready + " з 3 умов виконано", ready + " of 3 checks passed"));
        }
        refreshDiagnosticStatus();
    }

    private void runAlarmTest() {
        if (!notificationsAllowed()) {
            requestNotifications();
            Toast.makeText(this,
                    LanguageManager.pick(this, "Дозволь сповіщення і натисни перевірку ще раз", "Allow notifications, then run the test again"),
                    Toast.LENGTH_LONG).show();
            return;
        }
        if (!ReminderScheduler.canScheduleExactly(this)) {
            openExactAlarmSettings();
            Toast.makeText(this,
                    LanguageManager.pick(this, "Дозволь точні нагадування і повтори перевірку", "Allow exact reminders, then run the test again"),
                    Toast.LENGTH_LONG).show();
            return;
        }
        if (AlarmDiagnostics.scheduleTwoMinuteTest(this)) {
            Toast.makeText(this,
                    LanguageManager.pick(this, "Тест заплановано. Заблокуй екран на 2 хвилини.", "Test scheduled. Lock the screen for 2 minutes."),
                    Toast.LENGTH_LONG).show();
            refreshDiagnosticStatus();
        }
    }

    private void refreshDiagnosticStatus() {
        if (diagnosticStatus == null) return;
        long scheduled = AlarmDiagnostics.lastScheduled(this);
        long fired = AlarmDiagnostics.lastFired(this);
        long now = System.currentTimeMillis();
        if (scheduled == 0L) {
            diagnosticStatus.setText(LanguageManager.pick(this, "Тест ще не запускався", "The test has not been run"));
            diagnosticStatus.setTextColor(MUTED);
        } else if (fired >= scheduled - 5000L) {
            long seconds = Math.abs(fired - scheduled) / 1000L;
            diagnosticStatus.setText("✓ " + LanguageManager.pick(this,
                    "Останній тест успішний • відхилення " + seconds + " с",
                    "Last test passed • deviation " + seconds + " s"));
            diagnosticStatus.setTextColor(GREEN);
        } else if (scheduled > now) {
            diagnosticStatus.setText(LanguageManager.pick(this, "Тест очікує спрацювання", "Test is waiting to fire"));
            diagnosticStatus.setTextColor(BLUE);
        } else {
            diagnosticStatus.setText("! " + LanguageManager.pick(this,
                    "Тест не підтверджено — перевір дозволи й батарею",
                    "Test not confirmed — check permissions and battery"));
            diagnosticStatus.setTextColor(AMBER);
        }
    }

    private boolean notificationsAllowed() {
        if (Build.VERSION.SDK_INT >= 33) {
            return checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        return manager == null || manager.areNotificationsEnabled();
    }

    private void requestNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && !notificationsAllowed()) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 300);
        } else {
            openNotificationSettings();
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

    private void openExactAlarmSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return;
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    Uri.parse("package:" + getPackageName())));
        } catch (Exception e) {
            openAppSettings();
        }
    }

    private void openNotificationSettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
            startActivity(intent);
        } catch (Exception e) {
            openAppSettings();
        }
    }

    private void openAppSettings() {
        startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getPackageName())));
    }

    private LinearLayout card() {
        return UiKit.card(this);
    }

    private TextView sectionTitle(String value) {
        return text(value, 18, true, TEXT);
    }

    private Button primaryButton(String label) {
        return UiKit.primaryButton(this, label);
    }

    private Button secondaryButton(String label) {
        return UiKit.secondaryButton(this, label);
    }

    private TextView text(String value, int sp, boolean bold, int color) {
        return UiKit.text(this, value, sp, bold, color);
    }

    private GradientDrawable rounded(int fill, int stroke, int strokeWidth, int radius) {
        return UiKit.rounded(this, fill, stroke, strokeWidth, radius);
    }

    private LinearLayout.LayoutParams margin(int width, int height, int left, int top, int right, int bottom) {
        return UiKit.margin(this, width, height, left, top, right, bottom);
    }

    private int dp(int value) {
        return UiKit.dp(this, value);
    }
}
