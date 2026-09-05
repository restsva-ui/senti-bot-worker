package com.chef.watimer;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity {
    private EditText groupInput;
    private EditText messageInput;
    private TextView dateText;
    private TextView timeText;
    private Spinner repeatSpinner;
    private CheckBox businessCheck;
    private CheckBox exitCheck;
    private LinearLayout listContainer;
    private Button accessibilityButton;
    private Button exactAlarmButton;
    private Calendar selected = Calendar.getInstance();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        selected.add(Calendar.MINUTE, 5);
        selected.set(Calendar.SECOND, 0);
        selected.set(Calendar.MILLISECOND, 0);
        setContentView(buildUi());
        requestNotificationPermissionIfNeeded();
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyPickedTargetIfAny();
        updatePermissionButtons();
        renderSchedules();

        long pendingId = AutomationPrefs.getPendingId(this);
        if (pendingId != -1L && AutomationLauncher.canInteractNow(this)) {
            ScheduledMessage pending = ScheduleStore.get(this, pendingId);
            if (pending != null) AutomationLauncher.launchWhatsApp(this, pending);
        }
    }

    private View buildUi() {
        int pad = dp(16);
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, dp(28));
        scroll.addView(root);

        TextView title = text("WA Timer", 28, true);
        root.addView(title);
        TextView sub = text("Планувальник повідомлень у контакти, групи та підгрупи WhatsApp", 15, false);
        sub.setTextColor(Color.DKGRAY);
        root.addView(sub, lp(-1, -2, 0, 4, 0, 16));

        accessibilityButton = button("1. Увімкнути спецможливості WA Timer");
        accessibilityButton.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        root.addView(accessibilityButton);

        exactAlarmButton = button("2. Дозволити точні таймери");
        exactAlarmButton.setOnClickListener(v -> requestExactAlarmPermission());
        root.addView(exactAlarmButton, lp(-1, -2, 0, 8, 0, 16));

        groupInput = input("Контакт / група / підгрупа", false);
        root.addView(groupInput);

        Button pickTarget = button("ВИБРАТИ У WHATSAPP");
        pickTarget.setOnClickListener(v -> pickTargetFromWhatsApp());
        root.addView(pickTarget, lp(-1, -2, 0, 6, 0, 2));

        TextView pickerHint = text("Натисни кнопку — відкриється WhatsApp. Торкнись потрібного контакту, групи або підгрупи. WA Timer запам'ятає вибір і поверне тебе назад.", 13, false);
        pickerHint.setTextColor(Color.DKGRAY);
        root.addView(pickerHint, lp(-1, -2, 0, 0, 0, 10));

        messageInput = input("Текст повідомлення", true);
        root.addView(messageInput, lp(-1, dp(110), 0, 8, 0, 8));

        LinearLayout dateRow = new LinearLayout(this);
        dateRow.setOrientation(LinearLayout.HORIZONTAL);
        Button dateBtn = button("Дата");
        Button timeBtn = button("Час");
        dateText = text("", 16, true);
        timeText = text("", 16, true);
        dateText.setGravity(Gravity.CENTER_VERTICAL);
        timeText.setGravity(Gravity.CENTER_VERTICAL);
        dateBtn.setOnClickListener(v -> pickDate());
        timeBtn.setOnClickListener(v -> pickTime());
        dateRow.addView(dateBtn, new LinearLayout.LayoutParams(0, -2, 1));
        dateRow.addView(dateText, new LinearLayout.LayoutParams(0, -2, 1));
        dateRow.addView(timeBtn, new LinearLayout.LayoutParams(0, -2, 1));
        dateRow.addView(timeText, new LinearLayout.LayoutParams(0, -2, 1));
        root.addView(dateRow);
        refreshDateTimeLabels();

        repeatSpinner = new Spinner(this);
        String[] repeats = {"Одноразово", "Щодня", "Пн–Пт"};
        repeatSpinner.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, repeats));
        root.addView(repeatSpinner, lp(-1, -2, 0, 8, 0, 4));

        businessCheck = new CheckBox(this);
        businessCheck.setText("WhatsApp Business");
        root.addView(businessCheck);

        exitCheck = new CheckBox(this);
        exitCheck.setText("Після надсилання повернутися на головний екран");
        exitCheck.setChecked(true);
        root.addView(exitCheck, lp(-1, -2, 0, 0, 0, 8));

        Button save = button("ЗБЕРЕГТИ ТАЙМЕР");
        save.setOnClickListener(v -> saveSchedule());
        root.addView(save);

        Button test = button("ВІДПРАВИТИ ЗАРАЗ — ТЕСТ");
        test.setOnClickListener(v -> sendNow());
        root.addView(test, lp(-1, -2, 0, 8, 0, 18));

        TextView note = text("Важливо: телефон має бути розблокований у момент надсилання. Якщо він заблокований, WA Timer збереже завдання та продовжить після розблокування.", 14, false);
        note.setTextColor(Color.DKGRAY);
        root.addView(note, lp(-1, -2, 0, 0, 0, 18));

        TextView listTitle = text("Заплановані повідомлення", 20, true);
        root.addView(listTitle);
        listContainer = new LinearLayout(this);
        listContainer.setOrientation(LinearLayout.VERTICAL);
        root.addView(listContainer);
        return scroll;
    }

    private void pickTargetFromWhatsApp() {
        if (!isAccessibilityEnabled()) {
            toast("Спочатку увімкни спецможливості WA Timer");
            startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
            return;
        }

        boolean business = businessCheck.isChecked();
        String pkg = business ? "com.whatsapp.w4b" : "com.whatsapp";
        Intent launch = getPackageManager().getLaunchIntentForPackage(pkg);
        if (launch == null) {
            toast(business ? "WhatsApp Business не знайдено" : "WhatsApp не знайдено");
            return;
        }

        TargetPickerPrefs.begin(this, business);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        startActivity(launch);
        toast("Відкрий потрібний чат — WA Timer визначить його автоматично");
    }

    private void applyPickedTargetIfAny() {
        if (groupInput == null || businessCheck == null) return;

        if (TargetPickerPrefs.hasSelection(this)) {
            String name = TargetPickerPrefs.getSelectedName(this);
            boolean business = TargetPickerPrefs.getSelectedBusiness(this);
            if (!TextUtils.isEmpty(name)) {
                groupInput.setText(name);
                groupInput.setSelection(name.length());
                businessCheck.setChecked(business);
                toast("Вибрано: " + name);
            }
            TargetPickerPrefs.clearSelection(this);
        } else if (TargetPickerPrefs.isActive(this)) {
            TargetPickerPrefs.cancel(this);
        }
    }

    private void saveSchedule() {
        String group = groupInput.getText().toString().trim();
        String message = messageInput.getText().toString();
        if (TextUtils.isEmpty(group) || TextUtils.isEmpty(message.trim())) {
            toast("Вибери контакт/групу та введи текст повідомлення");
            return;
        }
        if (selected.getTimeInMillis() <= System.currentTimeMillis()) {
            toast("Вибери час у майбутньому");
            return;
        }
        ScheduledMessage item = fromForm();
        ScheduleStore.upsert(this, item);
        ScheduleEngine.schedule(this, item);
        toast("Таймер збережено");
        renderSchedules();
    }

    private void sendNow() {
        String group = groupInput.getText().toString().trim();
        String message = messageInput.getText().toString();
        if (TextUtils.isEmpty(group) || TextUtils.isEmpty(message.trim())) {
            toast("Вибери контакт/групу та введи текст повідомлення");
            return;
        }
        if (!isAccessibilityEnabled()) {
            toast("Спочатку увімкни спецможливості WA Timer");
            startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
            return;
        }
        ScheduledMessage item = fromForm();
        item.id = System.currentTimeMillis();
        item.repeatMode = ScheduledMessage.REPEAT_ONCE;
        item.enabled = false;
        item.lastStatus = "Тестовий запуск…";
        ScheduleStore.upsert(this, item);
        AutomationPrefs.setPending(this, item.id);
        if (!AutomationLauncher.canInteractNow(this)) {
            NotificationHelper.show(this, "WA Timer", "Розблокуйте телефон для тестового надсилання");
            toast("Розблокуй телефон — тест продовжиться автоматично");
            return;
        }
        if (!AutomationLauncher.launchWhatsApp(this, item)) {
            toast("WhatsApp не знайдено");
            AutomationPrefs.clear(this);
        }
    }

    private ScheduledMessage fromForm() {
        ScheduledMessage item = new ScheduledMessage();
        item.groupName = groupInput.getText().toString().trim();
        item.message = messageInput.getText().toString();
        item.triggerAtMillis = selected.getTimeInMillis();
        item.repeatMode = repeatSpinner.getSelectedItemPosition() == 1
                ? ScheduledMessage.REPEAT_DAILY
                : repeatSpinner.getSelectedItemPosition() == 2
                    ? ScheduledMessage.REPEAT_WEEKDAYS
                    : ScheduledMessage.REPEAT_ONCE;
        item.exitAfterSend = exitCheck.isChecked();
        item.useBusiness = businessCheck.isChecked();
        item.enabled = true;
        item.lastStatus = "Заплановано";
        return item;
    }

    private void renderSchedules() {
        if (listContainer == null) return;
        listContainer.removeAllViews();
        List<ScheduledMessage> all = ScheduleStore.getAll(this);
        if (all.isEmpty()) {
            TextView empty = text("Поки немає таймерів", 15, false);
            empty.setTextColor(Color.GRAY);
            listContainer.addView(empty);
            return;
        }
        SimpleDateFormat fmt = new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.getDefault());
        for (ScheduledMessage item : all) {
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.VERTICAL);
            row.setPadding(dp(12), dp(10), dp(12), dp(10));
            row.setBackgroundColor(0xFFF2F2F2);
            TextView info = text(fmt.format(new Date(item.triggerAtMillis)) + "  •  " + item.groupName, 16, true);
            TextView body = text(item.message, 14, false);
            TextView status = text("Статус: " + item.lastStatus + (item.enabled ? "" : "  [неактивний]"), 13, false);
            status.setTextColor(Color.DKGRAY);
            Button delete = button("Видалити");
            delete.setOnClickListener(v -> {
                ScheduleEngine.cancel(this, item.id);
                ScheduleStore.delete(this, item.id);
                if (AutomationPrefs.getPendingId(this) == item.id) AutomationPrefs.clear(this);
                renderSchedules();
            });
            row.addView(info);
            row.addView(body);
            row.addView(status);
            row.addView(delete, lp(-1, -2, 0, 6, 0, 0));
            listContainer.addView(row, lp(-1, -2, 0, 0, 0, 10));
        }
    }

    private void pickDate() {
        DatePickerDialog d = new DatePickerDialog(this, (view, year, month, day) -> {
            selected.set(Calendar.YEAR, year);
            selected.set(Calendar.MONTH, month);
            selected.set(Calendar.DAY_OF_MONTH, day);
            refreshDateTimeLabels();
        }, selected.get(Calendar.YEAR), selected.get(Calendar.MONTH), selected.get(Calendar.DAY_OF_MONTH));
        d.show();
    }

    private void pickTime() {
        TimePickerDialog d = new TimePickerDialog(this, (view, hour, minute) -> {
            selected.set(Calendar.HOUR_OF_DAY, hour);
            selected.set(Calendar.MINUTE, minute);
            selected.set(Calendar.SECOND, 0);
            selected.set(Calendar.MILLISECOND, 0);
            refreshDateTimeLabels();
        }, selected.get(Calendar.HOUR_OF_DAY), selected.get(Calendar.MINUTE), true);
        d.show();
    }

    private void refreshDateTimeLabels() {
        dateText.setText(new SimpleDateFormat("dd.MM.yyyy", Locale.getDefault()).format(selected.getTime()));
        timeText.setText(new SimpleDateFormat("HH:mm", Locale.getDefault()).format(selected.getTime()));
    }

    private void requestExactAlarmPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            toast("Для цієї версії Android окремий дозвіл не потрібен");
            return;
        }
        AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
        if (am.canScheduleExactAlarms()) {
            toast("Точні таймери вже дозволені");
            return;
        }
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    Uri.parse("package:" + getPackageName()));
            startActivity(i);
        } catch (Exception e) {
            startActivity(new Intent(Settings.ACTION_SETTINGS));
        }
    }

    private boolean isAccessibilityEnabled() {
        ComponentName expected = new ComponentName(this, WhatsAppAccessibilityService.class);
        String enabled = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (enabled == null) return false;
        TextUtils.SimpleStringSplitter splitter = new TextUtils.SimpleStringSplitter(':');
        splitter.setString(enabled);
        while (splitter.hasNext()) {
            ComponentName cn = ComponentName.unflattenFromString(splitter.next());
            if (expected.equals(cn)) return true;
        }
        return false;
    }

    private boolean canExactAlarm() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        return ((AlarmManager) getSystemService(Context.ALARM_SERVICE)).canScheduleExactAlarms();
    }

    private void updatePermissionButtons() {
        if (accessibilityButton != null) accessibilityButton.setText(isAccessibilityEnabled()
                ? "✓ Спецможливості WA Timer увімкнено"
                : "1. Увімкнути спецможливості WA Timer");
        if (exactAlarmButton != null) exactAlarmButton.setText(canExactAlarm()
                ? "✓ Точні таймери дозволені"
                : "2. Дозволити точні таймери");
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 44);
        }
    }

    private EditText input(String hint, boolean multiline) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setTextSize(17);
        if (multiline) {
            e.setGravity(Gravity.TOP | Gravity.START);
            e.setMinLines(3);
        } else {
            e.setSingleLine(true);
        }
        return e;
    }

    private Button button(String label) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        return b;
    }

    private TextView text(String value, int sp, boolean bold) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextSize(sp);
        if (bold) t.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        return t;
    }

    private LinearLayout.LayoutParams lp(int w, int h, int l, int t, int r, int b) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(w, h);
        p.setMargins(dp(l), dp(t), dp(r), dp(b));
        return p;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void toast(String s) {
        Toast.makeText(this, s, Toast.LENGTH_LONG).show();
    }
}
