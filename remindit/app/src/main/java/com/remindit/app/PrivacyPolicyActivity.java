package com.remindit.app;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

public class PrivacyPolicyActivity extends Activity {
    private static final int BG = UiKit.BG;
    private static final int TEXT = UiKit.TEXT;
    private static final int MUTED = UiKit.MUTED;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        UiKit.applySystemBars(this);
        setContentView(buildUi());
    }

    private ScrollView buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int horizontal = dp(18), top = dp(16), bottom = dp(36);
        root.setPadding(horizontal, top, horizontal, bottom);
        scroll.addView(root);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(horizontal, top + bars.top, horizontal, bottom + bars.bottom);
            return insets;
        });

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        Button back = UiKit.iconButton(this, "‹");
        back.setContentDescription(LanguageManager.pick(this, "Назад", "Back"));
        back.setOnClickListener(v -> finish());
        header.addView(back, new LinearLayout.LayoutParams(dp(48), dp(48)));
        LinearLayout title = new LinearLayout(this);
        title.setOrientation(LinearLayout.VERTICAL);
        title.addView(text(LanguageManager.pick(this, "Приватність", "Privacy"), 25, true, TEXT));
        title.addView(text(LanguageManager.pick(this,
                "Просто й без дрібного шрифту", "Plain language, no fine print"), 13, false, MUTED));
        header.addView(title, new LinearLayout.LayoutParams(0, -2, 1f));
        root.addView(header);

        TextView promise = text(LanguageManager.pick(this,
                "◇ Локальна обробка • без реклами • без трекінгу",
                "◇ Local processing • no ads • no tracking"), 13, true, UiKit.GREEN);
        promise.setPadding(dp(14), dp(12), dp(14), dp(12));
        promise.setBackground(UiKit.rounded(this, Color.rgb(240, 253, 250),
                Color.rgb(153, 246, 228), 1, 16));
        root.addView(promise, margin(-1, -2, 0, 10, 0, 12));

        root.addView(text(LanguageManager.pick(this,
                "Версія для RemindIt 0.10 • оновлено 8 вересня 2026",
                "For RemindIt 0.10 • updated 8 September 2026"),
                12, true, MUTED), margin(-1, -2, 0, 0, 0, 12));

        LinearLayout policyCard = UiKit.card(this);
        TextView body = text(LanguageManager.pick(this, ukrainianPolicy(), englishPolicy()), 15, false, TEXT);
        body.setLineSpacing(0f, 1.18f);
        body.setTextIsSelectable(true);
        policyCard.addView(body);
        root.addView(policyCard);
        return scroll;
    }

    private String ukrainianPolicy() {
        return "Локальна робота\n\n" +
                "RemindIt обробляє текст, посилання, скріншоти та фото, які користувач сам додає або надсилає через меню «Поділитися». Нагадування, їхній стан і локальні копії зображень зберігаються у приватній пам’яті застосунку на пристрої. Обліковий запис RemindIt і сервер синхронізації не використовуються.\n\n" +
                "OCR\n\n" +
                "Розпізнавання українського, англійського та російського тексту виконується на пристрої. Мовні моделі входять до APK; зображення не потрібно надсилати на віддалений OCR-сервіс.\n\n" +
                "Дозволи та сповіщення\n\n" +
                "Застосунок використовує дозволи на сповіщення, точні нагадування та відновлення розкладу після перезавантаження. Відображення на екрані блокування контролюється налаштуваннями Android.\n\n" +
                "Оригінали та видалення\n\n" +
                "Для зображення RemindIt створює приватну локальну копію. Посилання зберігається разом із нагадуванням і відкривається у зовнішньому браузері або сумісному застосунку. Видалення нагадування також видаляє його локальну копію зображення. Видалення RemindIt прибирає приватні дані відповідно до правил Android, з урахуванням системного резервного копіювання.\n\n" +
                "Аналітика та реклама\n\n" +
                "Поточна бета-версія не містить реклами, аналітики або стороннього трекінгу.\n\n" +
                "Зворотний зв’язок\n\n" +
                "Питання щодо приватності можна залишити у розділі Issues репозиторію restsva-ui/senti-bot-worker на GitHub.";
    }

    private String englishPolicy() {
        return "Local operation\n\n" +
                "RemindIt processes text, links, screenshots and photos that the user explicitly adds or shares. Reminders, their status and local image copies are stored in the app's private device storage. RemindIt has no account system or synchronization server.\n\n" +
                "OCR\n\n" +
                "Ukrainian, English and Russian OCR runs on the device. Language models are bundled in the APK, so images do not need to be uploaded to a remote OCR service.\n\n" +
                "Permissions and notifications\n\n" +
                "The app uses notification, exact-alarm and reboot-rescheduling capabilities. Lock-screen presentation is controlled by Android settings.\n\n" +
                "Originals and deletion\n\n" +
                "RemindIt creates a private local copy of a shared image. A saved link opens in an external browser or compatible app. Deleting a reminder also deletes its local image copy. Uninstalling RemindIt removes private app data under Android rules, subject to system backup settings.\n\n" +
                "Analytics and advertising\n\n" +
                "The current beta contains no advertising, analytics or third-party tracking.\n\n" +
                "Contact\n\n" +
                "Privacy questions can be submitted in the Issues section of the restsva-ui/senti-bot-worker GitHub repository.";
    }

    private TextView text(String value, int size, boolean bold, int color) {
        return UiKit.text(this, value, size, bold, color);
    }

    private LinearLayout.LayoutParams margin(int width, int height, int left, int top, int right, int bottom) {
        return UiKit.margin(this, width, height, left, top, right, bottom);
    }

    private int dp(int value) {
        return UiKit.dp(this, value);
    }
}
