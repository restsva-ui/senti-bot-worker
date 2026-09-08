package com.remindit.app;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import java.io.File;

public class OriginalViewerActivity extends Activity {
    private static final int BG = UiKit.BG;
    private static final int TEXT = UiKit.TEXT;
    private static final int MUTED = UiKit.MUTED;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        UiKit.applySystemBars(this);

        String path = getIntent().getStringExtra("image_path");
        setContentView(buildUi(path));
    }

    private ScrollView buildUi(String path) {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        final int horizontal = dp(18);
        final int top = dp(16);
        final int bottom = dp(28);
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
        title.addView(UiKit.text(this, LanguageManager.pick(this, "Оригінал", "Original"), 25, true, TEXT));
        title.addView(UiKit.text(this, LanguageManager.pick(this,
                "Приватна локальна копія", "Private local copy"), 13, false, MUTED));
        header.addView(title, new LinearLayout.LayoutParams(0, -2, 1f));
        root.addView(header, UiKit.margin(this, -1, -2, 0, 0, 0, 14));

        ImageView image = new ImageView(this);
        image.setAdjustViewBounds(true);
        image.setScaleType(ImageView.ScaleType.FIT_CENTER);
        image.setPadding(dp(8), dp(8), dp(8), dp(8));
        image.setBackground(UiKit.rounded(this, Color.WHITE, UiKit.BORDER, 1, 22));
        image.setElevation(dp(3));
        image.setClipToOutline(true);

        Bitmap bitmap = null;
        if (path != null) {
            File file = new File(path);
            if (file.exists()) bitmap = BitmapFactory.decodeFile(path);
        }

        if (bitmap != null) {
            image.setImageBitmap(bitmap);
            root.addView(image, new LinearLayout.LayoutParams(-1, -2));
            TextView note = UiKit.text(this, LanguageManager.pick(this,
                    "◇ Зображення доступне лише всередині RemindIt",
                    "◇ This image is available only inside RemindIt"), 12, true, UiKit.GREEN);
            note.setGravity(Gravity.CENTER);
            root.addView(note, UiKit.margin(this, -1, -2, 0, 12, 0, 0));
        } else {
            TextView missing = new TextView(this);
            missing.setText(LanguageManager.pick(this,
                    "Оригінальне зображення недоступне.",
                    "The original image is unavailable."));
            missing.setTextSize(16);
            missing.setTextColor(MUTED);
            missing.setGravity(Gravity.CENTER);
            missing.setPadding(dp(12), dp(40), dp(12), dp(40));
            root.addView(missing);
        }
        return scroll;
    }

    private int dp(int value) {
        return UiKit.dp(this, value);
    }
}
