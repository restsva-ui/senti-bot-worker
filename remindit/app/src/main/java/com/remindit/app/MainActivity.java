package com.remindit.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
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

import androidx.core.graphics.ColorUtils;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity {
    private LinearLayout reminderList;
    private LinearLayout statusHost;
    private EditText searchInput;
    private Spinner filterSpinner;
    private TextView heroUpcoming;
    private TextView heroToday;
    private TextView sectionTitle;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        UiKit.applySystemBars(this);
        setContentView(buildUi());
        requestNotificationPermission();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (ReminderScheduler.canScheduleExactly(this)) {
            new ReminderDb(this).rescheduleFuture(this);
        }
        renderStatus();
        renderReminders();
    }

    private View buildUi() {
        LinearLayout shell = new LinearLayout(this);
        shell.setOrientation(LinearLayout.VERTICAL);
        shell.setBackgroundColor(UiKit.BG);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setClipToPadding(false);
        shell.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1f));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        final int horizontal = 18;
        final int top = 12;
        root.setPadding(dp(horizontal), dp(top), dp(horizontal), dp(24));
        scroll.addView(root);

        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(dp(horizontal), dp(top) + bars.top, dp(horizontal), dp(24));
            return insets;
        });

        root.addView(buildHeader(), margin(-1, -2, 0, 0, 0, 16));
        root.addView(buildHero(), margin(-1, -2, 0, 0, 0, 14));

        statusHost = new LinearLayout(this);
        statusHost.setOrientation(LinearLayout.VERTICAL);
        root.addView(statusHost);

        root.addView(buildSearchTools(), margin(-1, -2, 0, 0, 0, 20));

        LinearLayout heading = new LinearLayout(this);
        heading.setOrientation(LinearLayout.HORIZONTAL);
        heading.setGravity(Gravity.CENTER_VERTICAL);
        sectionTitle = text("", 22, true, UiKit.TEXT);
        heading.addView(sectionTitle, new LinearLayout.LayoutParams(0, -2, 1f));
        heading.addView(UiKit.chip(this,
                LanguageManager.pick(this, "ПРИВАТНО", "PRIVATE"), UiKit.GREEN));
        root.addView(heading, margin(-1, -2, 2, 0, 2, 11));

        reminderList = new LinearLayout(this);
        reminderList.setOrientation(LinearLayout.VERTICAL);
        root.addView(reminderList);

        LinearLayout bottomNav = buildBottomNav();
        shell.addView(bottomNav, new LinearLayout.LayoutParams(-1, -2));
        ViewCompat.setOnApplyWindowInsetsListener(bottomNav, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(dp(8), dp(8), dp(8), dp(8) + bars.bottom);
            return insets;
        });
        return shell;
    }

    private View buildHeader() {
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.ic_logo);
        logo.setContentDescription("RemindIt");
        header.addView(logo, new LinearLayout.LayoutParams(dp(52), dp(52)));

        LinearLayout titleBlock = new LinearLayout(this);
        titleBlock.setOrientation(LinearLayout.VERTICAL);
        titleBlock.addView(text("RemindIt", 27, true, UiKit.TEXT));
        titleBlock.addView(text(LanguageManager.pick(this,
                "Розумна пам’ять у твоєму телефоні",
                "Smart memory on your phone"), 12, false, UiKit.MUTED),
                margin(-1, -2, 0, 2, 0, 0));
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(0, -2, 1f);
        titleParams.setMargins(dp(10), 0, dp(10), 0);
        header.addView(titleBlock, titleParams);

        Button settings = UiKit.iconButton(this, "⚙");
        settings.setContentDescription(LanguageManager.pick(this, "Налаштування", "Settings"));
        settings.setOnClickListener(v -> startActivity(new Intent(this, SettingsActivity.class)));
        header.addView(settings, new LinearLayout.LayoutParams(dp(50), dp(48)));
        return header;
    }

    private View buildHero() {
        LinearLayout hero = new LinearLayout(this);
        hero.setOrientation(LinearLayout.VERTICAL);
        hero.setPadding(dp(20), dp(20), dp(20), dp(20));
        hero.setBackground(UiKit.gradient(this, UiKit.INDIGO, UiKit.VIOLET, 26));
        hero.setElevation(dp(5));

        TextView privateChip = text(LanguageManager.pick(this,
                "✦ ЛОКАЛЬНО • БЕЗ ХМАРИ",
                "✦ LOCAL • NO CLOUD"), 11, true, Color.WHITE);
        privateChip.setGravity(Gravity.CENTER);
        privateChip.setPadding(dp(10), dp(6), dp(10), dp(6));
        privateChip.setBackground(UiKit.rounded(this,
                ColorUtils.setAlphaComponent(Color.WHITE, 30),
                ColorUtils.setAlphaComponent(Color.WHITE, 55), 1, 999));
        hero.addView(privateChip, new LinearLayout.LayoutParams(-2, -2));

        hero.addView(text(LanguageManager.pick(this,
                "Що важливо не пропустити?",
                "What must not be missed?"), 27, true, Color.WHITE),
                margin(-1, -2, 0, 16, 0, 0));
        hero.addView(text(LanguageManager.pick(this,
                "Надішли текст або скріншот — RemindIt знайде суть, час і нагадає заздалегідь.",
                "Share text or a screenshot — RemindIt finds the meaning, time and alerts you early."),
                14, false, ColorUtils.setAlphaComponent(Color.WHITE, 220)),
                margin(-1, -2, 0, 7, 0, 16));

        Button add = UiKit.secondaryButton(this,
                LanguageManager.pick(this, "＋ Створити нагадування", "＋ Create reminder"));
        add.setTextColor(UiKit.INDIGO_DARK);
        add.setBackground(UiKit.ripple(this,
                UiKit.rounded(this, Color.WHITE, Color.WHITE, 0, 17),
                ColorUtils.setAlphaComponent(UiKit.INDIGO, 28)));
        add.setOnClickListener(v -> startActivity(new Intent(this, AddReminderActivity.class)));
        hero.addView(add, new LinearLayout.LayoutParams(-1, dp(54)));

        LinearLayout stats = new LinearLayout(this);
        stats.setOrientation(LinearLayout.HORIZONTAL);
        heroUpcoming = statBlock(stats, LanguageManager.pick(this, "АКТИВНІ", "ACTIVE"));
        stats.addView(new View(this), new LinearLayout.LayoutParams(dp(10), 1));
        heroToday = statBlock(stats, LanguageManager.pick(this, "СЬОГОДНІ", "TODAY"));
        hero.addView(stats, margin(-1, -2, 0, 14, 0, 0));
        return hero;
    }

    private TextView statBlock(LinearLayout parent, String label) {
        LinearLayout block = new LinearLayout(this);
        block.setOrientation(LinearLayout.VERTICAL);
        block.setPadding(dp(13), dp(10), dp(13), dp(10));
        block.setBackground(UiKit.rounded(this,
                ColorUtils.setAlphaComponent(Color.WHITE, 24),
                ColorUtils.setAlphaComponent(Color.WHITE, 38), 1, 16));
        TextView value = text("0", 21, true, Color.WHITE);
        block.addView(value);
        block.addView(text(label, 10, true, ColorUtils.setAlphaComponent(Color.WHITE, 190)),
                margin(-1, -2, 0, 3, 0, 0));
        parent.addView(block, new LinearLayout.LayoutParams(0, -2, 1f));
        return value;
    }

    private View buildSearchTools() {
        LinearLayout tools = UiKit.card(this);
        tools.setElevation(0);
        tools.addView(text(LanguageManager.pick(this, "Знайти потрібне", "Find a reminder"),
                16, true, UiKit.TEXT));

        searchInput = new EditText(this);
        searchInput.setSingleLine(true);
        searchInput.setHint(LanguageManager.pick(this, "⌕  Пошук за змістом…", "⌕  Search by meaning…"));
        searchInput.setHintTextColor(Color.rgb(152, 162, 179));
        searchInput.setTextColor(UiKit.TEXT);
        searchInput.setTextSize(15);
        searchInput.setPadding(dp(14), 0, dp(14), 0);
        searchInput.setBackground(UiKit.rounded(this, UiKit.SURFACE_ALT, UiKit.BORDER, 1, 15));
        searchInput.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) { renderReminders(); }
            @Override public void afterTextChanged(Editable s) {}
        });
        tools.addView(searchInput, margin(-1, dp(52), 0, 11, 0, 9));

        filterSpinner = new Spinner(this);
        String[] filters = LanguageManager.isUk(this)
                ? new String[]{"Усі категорії", "Особисте", "Покупки", "Подорожі", "Робота", "Платежі", "Інше"}
                : new String[]{"All categories", "Personal", "Shopping", "Travel", "Work", "Bills", "Other"};
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, filters);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        filterSpinner.setAdapter(adapter);
        filterSpinner.setPadding(dp(10), 0, dp(10), 0);
        filterSpinner.setBackground(UiKit.rounded(this, UiKit.SURFACE_ALT, UiKit.BORDER, 1, 15));
        filterSpinner.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) {
                renderReminders();
            }
            @Override public void onNothingSelected(android.widget.AdapterView<?> parent) {}
        });
        tools.addView(filterSpinner, new LinearLayout.LayoutParams(-1, dp(50)));
        return tools;
    }

    private LinearLayout buildBottomNav() {
        LinearLayout nav = new LinearLayout(this);
        nav.setOrientation(LinearLayout.HORIZONTAL);
        nav.setGravity(Gravity.CENTER);
        nav.setPadding(dp(8), dp(8), dp(8), dp(8));
        nav.setBackgroundColor(UiKit.SURFACE);
        nav.setElevation(dp(12));

        nav.addView(navItem("⌂\n" + LanguageManager.pick(this, "Головна", "Home"), true, () -> {}),
                new LinearLayout.LayoutParams(0, dp(58), 1f));
        nav.addView(navItem("＋\n" + LanguageManager.pick(this, "Додати", "Add"), false,
                        () -> startActivity(new Intent(this, AddReminderActivity.class))),
                new LinearLayout.LayoutParams(0, dp(58), 1f));
        nav.addView(navItem("✓\n" + LanguageManager.pick(this, "Історія", "History"), false,
                        () -> startActivity(new Intent(this, HistoryActivity.class))),
                new LinearLayout.LayoutParams(0, dp(58), 1f));
        nav.addView(navItem("⚙\n" + LanguageManager.pick(this, "Опції", "Settings"), false,
                        () -> startActivity(new Intent(this, SettingsActivity.class))),
                new LinearLayout.LayoutParams(0, dp(58), 1f));
        return nav;
    }

    private TextView navItem(String label, boolean selected, Runnable action) {
        TextView item = text(label, 11, true, selected ? UiKit.INDIGO : UiKit.MUTED);
        item.setGravity(Gravity.CENTER);
        item.setLines(2);
        item.setClickable(true);
        item.setFocusable(true);
        item.setBackground(UiKit.ripple(this,
                UiKit.rounded(this, selected ? ColorUtils.setAlphaComponent(UiKit.INDIGO, 18)
                                : Color.TRANSPARENT,
                        Color.TRANSPARENT, 0, 15),
                ColorUtils.setAlphaComponent(UiKit.INDIGO, 25)));
        item.setOnClickListener(v -> action.run());
        return item;
    }

    private void renderStatus() {
        if (statusHost == null) return;
        statusHost.removeAllViews();
        boolean notifications = notificationsAllowed();
        boolean exact = ReminderScheduler.canScheduleExactly(this);
        if (notifications && exact) {
            statusHost.setVisibility(View.GONE);
            return;
        }

        statusHost.setVisibility(View.VISIBLE);
        LinearLayout warning = UiKit.card(this);
        warning.setElevation(0);
        warning.setBackground(UiKit.rounded(this,
                ColorUtils.setAlphaComponent(UiKit.AMBER, 16),
                ColorUtils.setAlphaComponent(UiKit.AMBER, 65), 1, 20));
        warning.addView(text("!  " + LanguageManager.pick(this, "Заверши налаштування", "Finish setup"),
                16, true, UiKit.AMBER));
        String message;
        if (!notifications && !exact) {
            message = LanguageManager.pick(this,
                    "Потрібні сповіщення й дозвіл на точні нагадування.",
                    "Notifications and exact-reminder access are required.");
        } else if (!notifications) {
            message = LanguageManager.pick(this,
                    "Сповіщення вимкнені — нагадування не буде видно.",
                    "Notifications are off, so reminders will not be visible.");
        } else {
            message = LanguageManager.pick(this,
                    "Дозволь точні нагадування, щоб вони не запізнювалися.",
                    "Allow exact reminders so alerts are not delayed.");
        }
        warning.addView(text(message, 13, false, UiKit.MUTED), margin(-1, -2, 0, 6, 0, 10));
        Button open = UiKit.softButton(this,
                LanguageManager.pick(this, "Відкрити налаштування", "Open settings"), UiKit.AMBER);
        open.setOnClickListener(v -> startActivity(new Intent(this, SettingsActivity.class)));
        warning.addView(open, new LinearLayout.LayoutParams(-1, dp(46)));
        statusHost.addView(warning, margin(-1, -2, 0, 0, 0, 14));
    }

    private void renderReminders() {
        if (reminderList == null) return;
        reminderList.removeAllViews();
        List<Reminder> all = new ReminderDb(this).getUpcoming();
        List<Reminder> reminders = filter(all);
        long now = System.currentTimeMillis();

        if (heroUpcoming != null) heroUpcoming.setText(String.valueOf(all.size()));
        if (heroToday != null) {
            int today = 0;
            for (Reminder reminder : all) {
                if (reminder.remindAt >= now && isSameDay(reminder.remindAt, now)) today++;
            }
            heroToday.setText(String.valueOf(today));
        }
        if (sectionTitle != null) {
            sectionTitle.setText(LanguageManager.pick(this,
                    reminders.isEmpty() ? "Майбутні" : "Майбутні • " + reminders.size(),
                    reminders.isEmpty() ? "Upcoming" : "Upcoming • " + reminders.size()));
        }

        if (reminders.isEmpty()) {
            LinearLayout empty = UiKit.card(this);
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(dp(22), dp(30), dp(22), dp(30));
            empty.setBackground(UiKit.rounded(this, UiKit.SURFACE_ALT,
                    ColorUtils.setAlphaComponent(UiKit.INDIGO, 35), 1, 22));
            TextView icon = text(all.isEmpty() ? "✦" : "⌕", 36, true, UiKit.INDIGO);
            icon.setGravity(Gravity.CENTER);
            empty.addView(icon);
            TextView title = text(LanguageManager.pick(this,
                    all.isEmpty() ? "Тут з’явиться важливе" : "Нічого не знайдено",
                    all.isEmpty() ? "Important things will appear here" : "Nothing found"),
                    18, true, UiKit.TEXT);
            title.setGravity(Gravity.CENTER);
            empty.addView(title, margin(-1, -2, 0, 9, 0, 0));
            TextView hint = text(LanguageManager.pick(this,
                    all.isEmpty() ? "Створи нагадування або поділись текстом чи скріншотом." : "Спробуй інший запит або категорію.",
                    all.isEmpty() ? "Create a reminder or share text or a screenshot." : "Try another query or category."),
                    13, false, UiKit.MUTED);
            hint.setGravity(Gravity.CENTER);
            empty.addView(hint, margin(-1, -2, 0, 7, 0, 12));
            if (all.isEmpty()) {
                Button add = UiKit.primaryButton(this, LanguageManager.pick(this, "＋ Додати перше", "＋ Add first"));
                add.setOnClickListener(v -> startActivity(new Intent(this, AddReminderActivity.class)));
                empty.addView(add, new LinearLayout.LayoutParams(-1, dp(50)));
            }
            reminderList.addView(empty);
            return;
        }

        int index = 0;
        for (Reminder reminder : reminders) {
            View item = reminderCard(reminder, now);
            item.setAlpha(0f);
            item.setTranslationY(dp(12));
            item.animate().alpha(1f).translationY(0f).setDuration(220L)
                    .setStartDelay(Math.min(index * 35L, 210L)).start();
            reminderList.addView(item, margin(-1, -2, 0, 0, 0, 12));
            index++;
        }
    }

    private View reminderCard(Reminder reminder, long now) {
        int categoryColor = UiKit.categoryColor(reminder.category);
        LinearLayout item = UiKit.card(this);
        item.setBackground(UiKit.rounded(this, UiKit.SURFACE,
                ColorUtils.setAlphaComponent(categoryColor, 65), 1, 22));

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.addView(UiKit.chip(this,
                UiKit.categoryIcon(reminder.category) + "  " + UiKit.categoryLabel(this, reminder.category),
                categoryColor));
        top.addView(new View(this), new LinearLayout.LayoutParams(0, 1, 1f));
        String urgency = urgencyLabel(reminder.remindAt, now);
        if (!urgency.isEmpty()) {
            int urgencyColor = reminder.remindAt < now ? UiKit.RED
                    : isSameDay(reminder.remindAt, now) ? UiKit.AMBER : UiKit.INDIGO;
            top.addView(UiKit.chip(this, urgency, urgencyColor));
        }
        item.addView(top);

        TextView essence = text(!TextUtils.isEmpty(reminder.goal) ? reminder.goal : reminder.title,
                19, true, UiKit.TEXT);
        essence.setMaxLines(3);
        item.addView(essence, margin(-1, -2, 0, 13, 0, 0));
        item.addView(text("◷  " + eventLabel(reminder.remindAt, now), 14, true,
                        reminder.remindAt < now ? UiKit.RED : categoryColor),
                margin(-1, -2, 0, 8, 0, 0));

        if (reminder.snoozeAt > now) {
            SimpleDateFormat format = new SimpleDateFormat("EEE, dd MMM • HH:mm",
                    LanguageManager.displayLocale(this));
            item.addView(text(LanguageManager.pick(this, "⏱  Відкладено до ", "⏱  Snoozed until ")
                            + format.format(new Date(reminder.snoozeAt)),
                    13, true, UiKit.SKY), margin(-1, -2, 0, 7, 0, 0));
        }

        TextView plan = text("🔔  " + ReminderUi.summary(this, reminder), 12, false, UiKit.MUTED);
        plan.setPadding(dp(12), dp(10), dp(12), dp(10));
        plan.setBackground(UiKit.rounded(this,
                ColorUtils.setAlphaComponent(categoryColor, 13),
                ColorUtils.setAlphaComponent(categoryColor, 28), 1, 13));
        item.addView(plan, margin(-1, -2, 0, 11, 0, 0));

        LinearLayout meta = new LinearLayout(this);
        meta.setOrientation(LinearLayout.HORIZONTAL);
        meta.setGravity(Gravity.CENTER_VERTICAL);
        meta.addView(UiKit.chip(this, sourceLabel(reminder), UiKit.MUTED));
        if (reminder.isRepeating()) {
            meta.addView(UiKit.chip(this, "↻ " + repeatLabel(reminder.repeatMode), UiKit.INDIGO),
                    margin(-2, -2, 7, 0, 0, 0));
        }
        item.addView(meta, margin(-1, -2, 0, 10, 0, 0));

        LinearLayout contextActions = new LinearLayout(this);
        contextActions.setOrientation(LinearLayout.HORIZONTAL);
        int contextCount = 0;
        if (SmartActions.available(reminder)) {
            Button smart = UiKit.softButton(this, SmartActions.label(this, reminder), categoryColor);
            smart.setOnClickListener(v -> SmartActions.open(this, reminder));
            contextActions.addView(smart, new LinearLayout.LayoutParams(0, dp(44), 1f));
            contextCount++;
        }
        if (reminder.hasImageOriginal() || reminder.hasLinkOriginal()) {
            if (contextCount > 0) contextActions.addView(new View(this), new LinearLayout.LayoutParams(dp(8), 1));
            Button original = UiKit.softButton(this, OriginalActions.actionLabel(this, reminder), UiKit.SKY);
            original.setOnClickListener(v -> OriginalActions.open(this, reminder));
            contextActions.addView(original, new LinearLayout.LayoutParams(0, dp(44), 1f));
            contextCount++;
        }
        if (contextCount > 0) item.addView(contextActions, margin(-1, -2, 0, 10, 0, 0));

        if (!TextUtils.isEmpty(reminder.body)) {
            Button details = UiKit.ghostButton(this,
                    LanguageManager.pick(this, "Показати вихідний текст", "Show source text"), UiKit.MUTED);
            TextView raw = text(reminder.body, 13, false, UiKit.MUTED);
            raw.setVisibility(View.GONE);
            raw.setPadding(dp(12), dp(11), dp(12), dp(11));
            raw.setTextIsSelectable(true);
            raw.setBackground(UiKit.rounded(this, UiKit.SURFACE_ALT, UiKit.BORDER, 1, 13));
            details.setOnClickListener(v -> {
                boolean show = raw.getVisibility() != View.VISIBLE;
                raw.setVisibility(show ? View.VISIBLE : View.GONE);
                details.setText(LanguageManager.pick(this,
                        show ? "Сховати вихідний текст" : "Показати вихідний текст",
                        show ? "Hide source text" : "Show source text"));
            });
            item.addView(details, new LinearLayout.LayoutParams(-1, dp(42)));
            item.addView(raw, margin(-1, -2, 0, 8, 0, 10));
        } else {
            item.addView(new View(this), new LinearLayout.LayoutParams(1, dp(10)));
        }

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        Button done = UiKit.softButton(this, LanguageManager.pick(this, "✓ Виконано", "✓ Done"), UiKit.GREEN);
        done.setOnClickListener(v -> complete(reminder));
        Button edit = UiKit.softButton(this, LanguageManager.pick(this, "✎ Змінити", "✎ Edit"), UiKit.INDIGO);
        edit.setOnClickListener(v -> {
            Intent intent = new Intent(this, EditReminderActivity.class);
            intent.putExtra("reminder_id", reminder.id);
            startActivity(intent);
        });
        Button delete = UiKit.ghostButton(this, LanguageManager.pick(this, "Видалити", "Delete"), UiKit.RED);
        delete.setOnClickListener(v -> confirmDelete(reminder));
        actions.addView(done, new LinearLayout.LayoutParams(0, dp(44), 1.15f));
        actions.addView(new View(this), new LinearLayout.LayoutParams(dp(7), 1));
        actions.addView(edit, new LinearLayout.LayoutParams(0, dp(44), 1f));
        actions.addView(new View(this), new LinearLayout.LayoutParams(dp(3), 1));
        actions.addView(delete, new LinearLayout.LayoutParams(0, dp(44), .85f));
        item.addView(actions);
        return item;
    }

    private void complete(Reminder reminder) {
        if (reminder.isRepeating()) {
            long next = ReminderScheduler.nextOccurrence(reminder,
                    Math.max(System.currentTimeMillis(), reminder.remindAt));
            if (next > 0) {
                reminder.remindAt = next;
                reminder.snoozeAt = 0L;
                new ReminderDb(this).update(reminder);
                ReminderScheduler.schedule(this, reminder);
            }
        } else {
            ReminderScheduler.cancel(this, reminder.id);
            new ReminderDb(this).markDone(reminder.id);
        }
        renderReminders();
    }

    private void confirmDelete(Reminder reminder) {
        new AlertDialog.Builder(this)
                .setTitle(LanguageManager.pick(this, "Видалити нагадування?", "Delete reminder?"))
                .setMessage(LanguageManager.pick(this,
                        "Нагадування, майбутні сигнали та локальна копія зображення будуть видалені.",
                        "The reminder, future alerts and local image copy will be deleted."))
                .setNegativeButton(LanguageManager.pick(this, "Скасувати", "Cancel"), null)
                .setPositiveButton(LanguageManager.pick(this, "Видалити", "Delete"), (dialog, which) -> {
                    ReminderScheduler.cancel(this, reminder.id);
                    new ReminderDb(this).delete(reminder.id);
                    renderReminders();
                })
                .show();
    }

    private List<Reminder> filter(List<Reminder> input) {
        ArrayList<Reminder> out = new ArrayList<>();
        String query = searchInput == null ? ""
                : searchInput.getText().toString().trim().toLowerCase(Locale.ROOT);
        int position = filterSpinner == null ? 0 : filterSpinner.getSelectedItemPosition();
        String wantedCategory = position == 0 ? null : categoryKeyForFilter(position);

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
        if (reminder.hasImageOriginal()) return LanguageManager.pick(this, "▧ Фото", "▧ Image");
        if (reminder.hasLinkOriginal()) return LanguageManager.pick(this, "↗ Посилання", "↗ Link");
        return LanguageManager.pick(this, "≡ Текст", "≡ Text");
    }

    private String urgencyLabel(long at, long now) {
        if (at < now) return LanguageManager.pick(this, "ПРОСТРОЧЕНО", "OVERDUE");
        if (isSameDay(at, now)) return LanguageManager.pick(this, "СЬОГОДНІ", "TODAY");
        Calendar tomorrow = Calendar.getInstance();
        tomorrow.setTimeInMillis(now);
        tomorrow.add(Calendar.DAY_OF_YEAR, 1);
        if (isSameDay(at, tomorrow.getTimeInMillis())) {
            return LanguageManager.pick(this, "ЗАВТРА", "TOMORROW");
        }
        return "";
    }

    private String eventLabel(long at, long now) {
        SimpleDateFormat time = new SimpleDateFormat("HH:mm", LanguageManager.displayLocale(this));
        if (at < now) {
            SimpleDateFormat full = new SimpleDateFormat("dd MMM • HH:mm", LanguageManager.displayLocale(this));
            return LanguageManager.pick(this, "Прострочено • ", "Overdue • ") + full.format(new Date(at));
        }
        if (isSameDay(at, now)) {
            return LanguageManager.pick(this, "Сьогодні • ", "Today • ") + time.format(new Date(at));
        }
        Calendar tomorrow = Calendar.getInstance();
        tomorrow.setTimeInMillis(now);
        tomorrow.add(Calendar.DAY_OF_YEAR, 1);
        if (isSameDay(at, tomorrow.getTimeInMillis())) {
            return LanguageManager.pick(this, "Завтра • ", "Tomorrow • ") + time.format(new Date(at));
        }
        SimpleDateFormat full = new SimpleDateFormat("EEE, dd MMM • HH:mm", LanguageManager.displayLocale(this));
        return full.format(new Date(at));
    }

    private boolean isSameDay(long first, long second) {
        Calendar a = Calendar.getInstance();
        Calendar b = Calendar.getInstance();
        a.setTimeInMillis(first);
        b.setTimeInMillis(second);
        return a.get(Calendar.ERA) == b.get(Calendar.ERA)
                && a.get(Calendar.YEAR) == b.get(Calendar.YEAR)
                && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR);
    }

    private boolean notificationsAllowed() {
        if (Build.VERSION.SDK_INT >= 33) {
            return checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED;
        }
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        return manager == null || manager.areNotificationsEnabled();
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && !notificationsAllowed()) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 100);
        }
    }

    private TextView text(String value, int sp, boolean bold, int color) {
        return UiKit.text(this, value, sp, bold, color);
    }

    private LinearLayout.LayoutParams margin(int width, int height,
                                             int left, int top, int right, int bottom) {
        return UiKit.margin(this, width, height, left, top, right, bottom);
    }

    private int dp(int value) {
        return UiKit.dp(this, value);
    }
}
