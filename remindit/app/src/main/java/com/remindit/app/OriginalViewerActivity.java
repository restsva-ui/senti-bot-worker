package com.remindit.app;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
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
    private static final int BG = Color.rgb(247, 250, 255);
    private static final int TEXT = Color.rgb(15, 23, 42);
    private static final int MUTED = Color.rgb(100, 116, 139);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(Color.WHITE);

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

        Button back = new Button(this);
        back.setText("‹");
        back.setTextSize(30);
        back.setBackgroundColor(Color.TRANSPARENT);
        back.setTextColor(TEXT);
        back.setOnClickListener(v -> finish());
        header.addView(back, new LinearLayout.LayoutParams(dp(52), dp(54)));

        TextView title = new TextView(this);
        title.setText(LanguageManager.pick(this, "Оригінал", "Original"));
        title.setTextSize(24);
        title.setTextColor(TEXT);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        header.addView(title, new LinearLayout.LayoutParams(0, -2, 1f));
        root.addView(header);

        ImageView image = new ImageView(this);
        image.setAdjustViewBounds(true);
        image.setScaleType(ImageView.ScaleType.FIT_CENTER);
        image.setBackgroundColor(Color.WHITE);

        Bitmap bitmap = null;
        if (path != null) {
            File file = new File(path);
            if (file.exists()) bitmap = BitmapFactory.decodeFile(path);
        }

        if (bitmap != null) {
            image.setImageBitmap(bitmap);
            root.addView(image, new LinearLayout.LayoutParams(-1, -2));
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
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
