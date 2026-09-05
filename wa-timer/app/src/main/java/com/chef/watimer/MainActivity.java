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
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.ImageView;
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
    private static final int COLOR_BG = Color.rgb(10, 10, 13);
    private static final int COLOR_SURFACE = Color.rgb(22, 22, 28);
    private static final int COLOR_SURFACE_2 = Color.rgb(31, 31, 39);
    private static final int COLOR_GOLD = Color.rgb(240, 190, 38);
    private static final int COLOR_GOLD_DARK = Color.rgb(151, 107, 12);
    private static final int COLOR_MAGENTA = Color.rgb(226, 0, 139);
    private static final int COLOR_MAGENTA_DARK = Color.rgb(137, 0, 81);
    private static final int COLOR_TEXT = Color.rgb(247, 247, 249);
    private static final int COLOR_TEXT_2 = Color.rgb(201, 201, 207);
    private static final int COLOR_HINT = Color.rgb(142, 143, 153);
    private static final int COLOR_STROKE = Color.rgb(55, 55, 67);
    private static final int COLOR_DANGER = Color.rgb(117, 26, 38);

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
    private final Calendar selected = Calendar.getInstance();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(COLOR_BG);
        getWindow().setNavigationBarColor(COLOR_BG);

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
            if (pending != null) {
                AutomationLauncher.launchWhatsApp(this, pending);
            }
        }
    }

    private View buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(COLOR_BG);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(16), dp(14), dp(16), dp(32));
        scroll.addView(root);

        root.addView(buildHeaderCard(), lp(-1, -2, 0, 0, 0, 14));
        root.addView(buildPermissionsCard(), lp(-1, -2, 0, 0, 0, 14));
        root.addView(buildTargetCard(), lp(-1, -2, 0, 0, 0, 14));
        root.addView(buildMessageCard(), lp(-1, -2, 0, 0, 0, 14));
        root.addView(buildScheduleCard(), lp(-1, -2, 0, 0, 0, 14));
        root.addView(buildActionsCard(), lp(-1, -2, 0, 0, 0, 14));

        TextView info = text(
                "Телефон має бути розблокований у момент надсилання. Якщо він заблокований, 4.5.0 збереже завдання та продовжить після розблокування.",
                13,
                false
        );
        info.setTextColor(COLOR_HINT);
        info.setPadding(dp(4), 0, dp(4), 0);
        root.addView(info, lp(-1, -2, 0, 0, 0, 20));

        TextView listTitle = text("Заплановані повідомлення", 21, true);
        listTitle.setTextColor(COLOR_TEXT);
        root.addView(listTitle, lp(-1, -2, 0, 0, 0, 10));

        listContainer = new LinearLayout(this);
        listContainer.setOrientation(LinearLayout.VERTICAL);
        root.addView(listContainer);

        return scroll;
    }

    private View buildHeaderCard() {
        LinearLayout card = card();

        ImageView emblem = new ImageView(this);
        emblem.setImageResource(R.drawable.emblem_450);
        emblem.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        emblem.setAdjustViewBounds(true);
        card.addView(emblem, new LinearLayout.LayoutParams(-1, dp(165)));

        TextView title = text("4.5.0", 31, true);
        title.setTextColor(COLOR_GOLD);
        title.setGravity(Gravity.CENTER);
        card.addView(title, lp(-1, -2, 0, 4, 0, 0));

        TextView sub = text("WhatsApp Message Scheduler", 13, true);
        sub.setTextColor(COLOR_MAGENTA);
        sub.setGravity(Gravity.CENTER);
        card.addView(sub, lp(-1, -2, 0, 2, 0, 12));

        View bar = new View(this);
        GradientDrawable gradient = new GradientDrawable(
                GradientDrawable.Orientation.LEFT_RIGHT,
                new int[]{COLOR_MAGENTA, COLOR_GOLD}
        );
        gradient.setCornerRadius(dp(8));
        bar.setBackground(gradient);
        card.addView(bar, new LinearLayout.LayoutParams(-1, dp(4)));

        TextView desc = text(
                "Планування повідомлень для контактів, груп і підгруп WhatsApp.",
                14,
                false
        );
        desc.setTextColor(COLOR_TEXT_2);
        desc.setGravity(Gravity.CENTER);
        card.addView(desc, lp(-1, -2, 0, 12, 0, 0));

        return card;
    }

    private View buildPermissionsCard() {
        LinearLayout card = card();
        card.addView(sectionTitle("Системні дозволи"));

        accessibilityButton = goldButton("1. Увімкнути спецможливості 4.5.0");
        accessibilityButton.setOnClickListener(
                v -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        );
        card.addView(accessibilityButton, lp(-1, -2, 0, 10, 0, 8));

        exactAlarmButton = darkButton("2. Дозволити точні таймери");
        exactAlarmButton.setOnClickListener(v -> requestExactAlarmPermission());
        card.addView(exactAlarmButton);

        return card;
    }

    private View buildTargetCard() {
        LinearLayout card = card();
        card.addView(sectionTitle("Одержувач"));

        groupInput = input("Контакт / група / підгрупа", false);
        card.addView(groupInput, lp(-1, -2, 0, 10, 0, 8));

        Button pickTarget = magentaButton("ВИБРАТИ У WHATSAPP");
        pickTarget.setOnClickListener(v -> pickTargetFromWhatsApp());
        card.addView(pickTarget);

        TextView hint = text(
                "Відкрий потрібний чат у WhatsApp. 4.5.0 визначить назву та поверне її сюди.",
                12,
                false
        );
        hint.setTextColor(COLOR_HINT);
        card.addView(hint, lp(-1, -2, 2, 9, 2, 0));

        return card;
    }

    private View buildMessageCard() {
        LinearLayout card = card();
        card.addView(sectionTitle("Повідомлення"));

        messageInput = input("Текст повідомлення", true);
        messageInput.setMinLines(4);
        messageInput.setGravity(Gravity.TOP | Gravity.START);
        messageInput.setInputType(
                InputType.TYPE_CLASS_TEXT |
                InputType.TYPE_TEXT_FLAG_MULTI_LINE |
                InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        );
        card.addView(messageInput, lp(-1, dp(132), 0, 10, 0, 0));

        return card;
    }

    private View buildScheduleCard() {
        LinearLayout card = card();
        card.addView(sectionTitle("Розклад"));

        LinearLayout dateTimeRow = new LinearLayout(this);
        dateTimeRow.setOrientation(LinearLayout.HORIZONTAL);

        LinearLayout dateBlock = valueBlock("Дата");
        dateText = (TextView) dateBlock.getChildAt(1);
        dateText.setOnClickListener(v -> pickDate());

        LinearLayout timeBlock = valueBlock("Час");
        timeText = (TextView) timeBlock.getChildAt(1);
        timeText.setOnClickListener(v -> pickTime());

        dateTimeRow.addView(dateBlock, new LinearLayout.LayoutParams(0, -2, 1f));
        LinearLayout.LayoutParams spacer = new LinearLayout.LayoutParams(dp(10), 1);
        View space = new View(this);
        dateTimeRow.addView(space, spacer);
        dateTimeRow.addView(timeBlock, new LinearLayout.LayoutParams(0, -2, 1f));

        card.addView(dateTimeRow, lp(-1, -2, 0, 10, 0, 10));
        refreshDateTimeLabels();

        String[] repeats = {"Одноразово", "Щодня", "Пн–Пт"};
        repeatSpinner = new Spinner(this);
        repeatSpinner.setAdapter(themedSpinnerAdapter(repeats));
        repeatSpinner.setBackground(makeRounded(COLOR_SURFACE_2, COLOR_STROKE, 1, 14));
        repeatSpinner.setPadding(dp(8), dp(4), dp(8), dp(4));
        card.addView(repeatSpinner, lp(-1, dp(54), 0, 0, 0, 8));

        businessCheck = checkBox("WhatsApp Business");
        card.addView(businessCheck);

        exitCheck = checkBox("Після надсилання повернутися на головний екран");
        exitCheck.setChecked(true);
        card.addView(exitCheck, lp(-1, -2, 0, 2, 0, 0));

        return card;
    }

    private View buildActionsCard() {
        LinearLayout card = card();
        card.addView(sectionTitle("Керування"));

        Button save = goldButton("ЗБЕРЕГТИ ТАЙМЕР");
        save.setOnClickListener(v -> saveSchedule());
        card.addView(save, lp(-1, -2, 0, 10, 0, 8));

        Button test = magentaButton("ВІДПРАВИТИ ЗАРАЗ — ТЕСТ");
        test.setOnClickListener(v -> sendNow());
        card.addView(test);

        return card;
    }

    private LinearLayout valueBlock(String label) {
        LinearLayout block = new LinearLayout(this);
        block.setOrientation(LinearLayout.VERTICAL);

        TextView l = text(label, 12, true);
        l.setTextColor(COLOR_HINT);
        block.addView(l, lp(-1, -2, 2, 0, 0, 5));

        TextView value = text("", 16, true);
        value.setTextColor(COLOR_TEXT);
        value.setGravity(Gravity.CENTER);
        value.setPadding(dp(10), dp(14), dp(10), dp(14));
        value.setBackground(makeRounded(COLOR_SURFACE_2, COLOR_STROKE, 1, 14));
        block.addView(value, new LinearLayout.LayoutParams(-1, -2));

        return block;
    }

    private void pickTargetFromWhatsApp() {
        if (!isAccessibilityEnabled()) {
            toast("Спочатку увімкни спецможливості 4.5.0");
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
        toast("Відкрий потрібний чат — 4.5.0 визначить його автоматично");
    }

    private void applyPickedTargetIfAny() {
        if (groupInput == null || businessCheck == null) {
            return;
        }

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
            toast("Спочатку увімкни спецможливості 4.5.0");
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
            NotificationHelper.show(this, "4.5.0", "Розблокуйте телефон для тестового надсилання");
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
        if (listContainer == null) {
            return;
        }

        listContainer.removeAllViews();
        List<ScheduledMessage> all = ScheduleStore.getAll(this);

        if (all.isEmpty()) {
            TextView empty = text("Поки немає таймерів", 14, false);
            empty.setTextColor(COLOR_HINT);
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(dp(10), dp(18), dp(10), dp(18));
            empty.setBackground(makeRounded(COLOR_SURFACE, COLOR_STROKE, 1, 16));
            listContainer.addView(empty);
            return;
        }

        SimpleDateFormat fmt = new SimpleDateFormat("dd.MM.yyyy  HH:mm", Locale.getDefault());

        for (ScheduledMessage item : all) {
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.VERTICAL);
            row.setPadding(dp(14), dp(14), dp(14), dp(14));
            row.setBackground(makeRounded(COLOR_SURFACE, COLOR_STROKE, 1, 16));

            TextView target = text(item.groupName, 17, true);
            target.setTextColor(COLOR_GOLD);

            TextView when = text(fmt.format(new Date(item.triggerAtMillis)), 13, true);
            when.setTextColor(COLOR_MAGENTA);

            TextView body = text(item.message, 14, false);
            body.setTextColor(COLOR_TEXT_2);

            TextView status = text(
                    "Статус: " + item.lastStatus + (item.enabled ? "" : " • неактивний"),
                    12,
                    false
            );
            status.setTextColor(COLOR_HINT);

            Button delete = dangerButton("Видалити");
            delete.setOnClickListener(v -> {
                ScheduleEngine.cancel(this, item.id);
                ScheduleStore.delete(this, item.id);

                if (AutomationPrefs.getPendingId(this) == item.id) {
                    AutomationPrefs.clear(this);
                }

                renderSchedules();
            });

            row.addView(target);
            row.addView(when, lp(-1, -2, 0, 3, 0, 8));
            row.addView(body);
            row.addView(status, lp(-1, -2, 0, 7, 0, 8));
            row.addView(delete);

            listContainer.addView(row, lp(-1, -2, 0, 0, 0, 10));
        }
    }

    private void pickDate() {
        DatePickerDialog dialog = new DatePickerDialog(
                this,
                (view, year, month, day) -> {
                    selected.set(Calendar.YEAR, year);
                    selected.set(Calendar.MONTH, month);
                    selected.set(Calendar.DAY_OF_MONTH, day);
                    refreshDateTimeLabels();
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
                    refreshDateTimeLabels();
                },
                selected.get(Calendar.HOUR_OF_DAY),
                selected.get(Calendar.MINUTE),
                true
        );
        dialog.show();
    }

    private void refreshDateTimeLabels() {
        if (dateText != null) {
            dateText.setText(
                    new SimpleDateFormat("dd.MM.yyyy", Locale.getDefault()).format(selected.getTime())
            );
        }

        if (timeText != null) {
            timeText.setText(
                    new SimpleDateFormat("HH:mm", Locale.getDefault()).format(selected.getTime())
            );
        }
    }

    private void requestExactAlarmPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            toast("Для цієї версії Android окремий дозвіл не потрібен");
            return;
        }

        AlarmManager alarmManager =
                (AlarmManager) getSystemService(Context.ALARM_SERVICE);

        if (alarmManager.canScheduleExactAlarms()) {
            toast("Точні таймери вже дозволені");
            return;
        }

        try {
            Intent intent = new Intent(
                    Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    Uri.parse("package:" + getPackageName())
            );
            startActivity(intent);
        } catch (Exception e) {
            startActivity(new Intent(Settings.ACTION_SETTINGS));
        }
    }

    private boolean isAccessibilityEnabled() {
        ComponentName expected =
                new ComponentName(this, WhatsAppAccessibilityService.class);

        String enabled = Settings.Secure.getString(
                getContentResolver(),
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        );

        if (enabled == null) {
            return false;
        }

        TextUtils.SimpleStringSplitter splitter =
                new TextUtils.SimpleStringSplitter(':');
        splitter.setString(enabled);

        while (splitter.hasNext()) {
            ComponentName componentName =
                    ComponentName.unflattenFromString(splitter.next());

            if (expected.equals(componentName)) {
                return true;
            }
        }

        return false;
    }

    private boolean canExactAlarm() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return true;
        }

        AlarmManager alarmManager =
                (AlarmManager) getSystemService(Context.ALARM_SERVICE);

        return alarmManager.canScheduleExactAlarms();
    }

    private void updatePermissionButtons() {
        if (accessibilityButton != null) {
            accessibilityButton.setText(
                    isAccessibilityEnabled()
                            ? "✓ Спецможливості 4.5.0 увімкнено"
                            : "1. Увімкнути спецможливості 4.5.0"
            );
        }

        if (exactAlarmButton != null) {
            exactAlarmButton.setText(
                    canExactAlarm()
                            ? "✓ Точні таймери дозволені"
                            : "2. Дозволити точні таймери"
            );
        }
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(
                    new String[]{Manifest.permission.POST_NOTIFICATIONS},
                    44
            );
        }
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(16), dp(16), dp(16));
        card.setBackground(makeRounded(COLOR_SURFACE, COLOR_STROKE, 1, 18));
        return card;
    }

    private TextView sectionTitle(String value) {
        TextView title = text(value, 18, true);
        title.setTextColor(COLOR_GOLD);
        return title;
    }

    private EditText input(String hint, boolean multiline) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setTextSize(16);
        input.setTextColor(COLOR_TEXT);
        input.setHintTextColor(COLOR_HINT);
        input.setBackground(makeRounded(COLOR_SURFACE_2, COLOR_STROKE, 1, 14));
        input.setPadding(dp(14), dp(13), dp(14), dp(13));

        if (multiline) {
            input.setGravity(Gravity.TOP | Gravity.START);
            input.setMinLines(3);
        } else {
            input.setSingleLine(true);
        }

        return input;
    }

    private ArrayAdapter<String> themedSpinnerAdapter(String[] values) {
        return new ArrayAdapter<String>(
                this,
                android.R.layout.simple_spinner_item,
                values
        ) {
            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                TextView view =
                        (TextView) super.getView(position, convertView, parent);
                styleSpinnerText(view, false);
                return view;
            }

            @Override
            public View getDropDownView(
                    int position,
                    View convertView,
                    ViewGroup parent
            ) {
                TextView view =
                        (TextView) super.getDropDownView(position, convertView, parent);
                styleSpinnerText(view, true);
                return view;
            }
        };
    }

    private void styleSpinnerText(TextView view, boolean dropdown) {
        view.setTextColor(COLOR_TEXT);
        view.setTextSize(16);
        view.setPadding(dp(12), dp(10), dp(12), dp(10));

        if (dropdown) {
            view.setBackgroundColor(COLOR_SURFACE_2);
        }
    }

    private CheckBox checkBox(String label) {
        CheckBox box = new CheckBox(this);
        box.setText(label);
        box.setTextColor(COLOR_TEXT_2);
        box.setTextSize(14);
        box.setButtonTintList(
                new ColorStateList(
                        new int[][]{
                                new int[]{android.R.attr.state_checked},
                                new int[]{}
                        },
                        new int[]{COLOR_GOLD, COLOR_HINT}
                )
        );
        return box;
    }

    private Button goldButton(String label) {
        Button button = baseButton(label);
        button.setTextColor(Color.BLACK);
        button.setBackground(makeRounded(COLOR_GOLD, COLOR_GOLD_DARK, 1, 15));
        return button;
    }

    private Button magentaButton(String label) {
        Button button = baseButton(label);
        button.setTextColor(Color.WHITE);
        button.setBackground(makeRounded(COLOR_MAGENTA, COLOR_MAGENTA_DARK, 1, 15));
        return button;
    }

    private Button darkButton(String label) {
        Button button = baseButton(label);
        button.setTextColor(COLOR_TEXT);
        button.setBackground(makeRounded(COLOR_SURFACE_2, COLOR_STROKE, 1, 15));
        return button;
    }

    private Button dangerButton(String label) {
        Button button = baseButton(label);
        button.setTextColor(Color.WHITE);
        button.setBackground(makeRounded(COLOR_DANGER, Color.rgb(166, 36, 54), 1, 14));
        return button;
    }

    private Button baseButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(14);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setPadding(dp(12), dp(12), dp(12), dp(12));
        button.setMinHeight(dp(50));
        return button;
    }

    private TextView text(String value, int sp, boolean bold) {
        TextView textView = new TextView(this);
        textView.setText(value);
        textView.setTextSize(sp);

        if (bold) {
            textView.setTypeface(Typeface.DEFAULT_BOLD);
        }

        return textView;
    }

    private GradientDrawable makeRounded(
            int fill,
            int stroke,
            int strokeDp,
            int radiusDp
    ) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(radiusDp));
        drawable.setStroke(dp(strokeDp), stroke);
        return drawable;
    }

    private LinearLayout.LayoutParams lp(
            int width,
            int height,
            int left,
            int top,
            int right,
            int bottom
    ) {
        LinearLayout.LayoutParams params =
                new LinearLayout.LayoutParams(width, height);
        params.setMargins(
                dp(left),
                dp(top),
                dp(right),
                dp(bottom)
        );
        return params;
    }

    private int dp(int value) {
        return Math.round(
                value * getResources().getDisplayMetrics().density
        );
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_LONG).show();
    }
}
