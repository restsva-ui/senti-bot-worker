package com.remindit.app;

import android.app.Activity;
import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.graphics.ColorUtils;

public final class UiKit {
    public static final int INDIGO = Color.rgb(79, 70, 229);
    public static final int INDIGO_DARK = Color.rgb(55, 48, 163);
    public static final int VIOLET = Color.rgb(124, 58, 237);
    public static final int SKY = Color.rgb(14, 165, 233);
    public static final int TEXT = Color.rgb(24, 32, 51);
    public static final int MUTED = Color.rgb(102, 112, 133);
    public static final int BG = Color.rgb(246, 247, 252);
    public static final int SURFACE = Color.WHITE;
    public static final int SURFACE_ALT = Color.rgb(241, 244, 255);
    public static final int BORDER = Color.rgb(226, 229, 240);
    public static final int GREEN = Color.rgb(22, 163, 74);
    public static final int AMBER = Color.rgb(217, 119, 6);
    public static final int RED = Color.rgb(220, 38, 38);
    public static final int YELLOW = Color.rgb(250, 204, 21);

    private UiKit() {}

    public static void applySystemBars(Activity activity) {
        activity.getWindow().setStatusBarColor(BG);
        activity.getWindow().setNavigationBarColor(SURFACE);
    }

    public static int dp(Context context, int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    public static TextView text(Context context, String value, int sp, boolean bold, int color) {
        TextView view = new TextView(context);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setIncludeFontPadding(false);
        view.setLineSpacing(0f, 1.08f);
        if (bold) view.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        return view;
    }

    public static TextView chip(Context context, String value, int color) {
        TextView chip = text(context, value, 11, true, color);
        chip.setGravity(Gravity.CENTER);
        chip.setSingleLine(true);
        chip.setPadding(dp(context, 10), dp(context, 6), dp(context, 10), dp(context, 6));
        chip.setBackground(rounded(context, ColorUtils.setAlphaComponent(color, 24),
                ColorUtils.setAlphaComponent(color, 56), 1, 999));
        return chip;
    }

    public static LinearLayout card(Context context) {
        LinearLayout card = new LinearLayout(context);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(context, 17), dp(context, 17), dp(context, 17), dp(context, 17));
        card.setBackground(rounded(context, SURFACE, BORDER, 1, 22));
        card.setElevation(dp(context, 2));
        return card;
    }

    public static Button primaryButton(Context context, String label) {
        Button button = baseButton(context, label);
        button.setTextColor(Color.WHITE);
        button.setBackground(ripple(context,
                gradient(context, INDIGO, VIOLET, 17), ColorUtils.setAlphaComponent(Color.WHITE, 40)));
        button.setElevation(dp(context, 3));
        return button;
    }

    public static Button secondaryButton(Context context, String label) {
        Button button = baseButton(context, label);
        button.setTextColor(INDIGO);
        button.setBackground(ripple(context,
                rounded(context, SURFACE, ColorUtils.setAlphaComponent(INDIGO, 105), 1, 15),
                ColorUtils.setAlphaComponent(INDIGO, 24)));
        return button;
    }

    public static Button softButton(Context context, String label, int color) {
        Button button = baseButton(context, label);
        button.setTextColor(color);
        button.setTextSize(13);
        button.setBackground(ripple(context,
                rounded(context, ColorUtils.setAlphaComponent(color, 20),
                        ColorUtils.setAlphaComponent(color, 48), 1, 14),
                ColorUtils.setAlphaComponent(color, 30)));
        return button;
    }

    public static Button ghostButton(Context context, String label, int color) {
        Button button = baseButton(context, label);
        button.setTextColor(color);
        button.setTextSize(13);
        button.setBackground(ripple(context,
                rounded(context, Color.TRANSPARENT, Color.TRANSPARENT, 0, 14),
                ColorUtils.setAlphaComponent(color, 24)));
        return button;
    }

    public static Button iconButton(Context context, String label) {
        Button button = baseButton(context, label);
        button.setTextColor(TEXT);
        button.setTextSize(20);
        button.setPadding(0, 0, 0, 0);
        button.setBackground(ripple(context,
                rounded(context, SURFACE, BORDER, 1, 15),
                ColorUtils.setAlphaComponent(INDIGO, 26)));
        return button;
    }

    private static Button baseButton(Context context, String label) {
        Button button = new Button(context);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(14);
        button.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        button.setGravity(Gravity.CENTER);
        button.setMinHeight(0);
        button.setMinWidth(0);
        button.setStateListAnimator(null);
        button.setPadding(dp(context, 12), 0, dp(context, 12), 0);
        return button;
    }

    public static GradientDrawable rounded(Context context, int fill, int stroke, int width, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(context, radius));
        if (width > 0) drawable.setStroke(dp(context, width), stroke);
        return drawable;
    }

    public static GradientDrawable gradient(Context context, int start, int end, int radius) {
        GradientDrawable drawable = new GradientDrawable(
                GradientDrawable.Orientation.TL_BR, new int[]{start, end});
        drawable.setCornerRadius(dp(context, radius));
        return drawable;
    }

    public static Drawable ripple(Context context, Drawable content, int rippleColor) {
        return new RippleDrawable(ColorStateList.valueOf(rippleColor), content, null);
    }

    public static LinearLayout.LayoutParams margin(Context context, int width, int height,
                                                    int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(width, height);
        params.setMargins(dp(context, left), dp(context, top), dp(context, right), dp(context, bottom));
        return params;
    }

    public static int categoryColor(String category) {
        if ("Personal".equals(category)) return VIOLET;
        if ("Shopping".equals(category)) return Color.rgb(219, 39, 119);
        if ("Travel".equals(category)) return SKY;
        if ("Work".equals(category)) return INDIGO;
        if ("Bills".equals(category)) return AMBER;
        return Color.rgb(71, 85, 105);
    }

    public static String categoryIcon(String category) {
        if ("Personal".equals(category)) return "♥";
        if ("Shopping".equals(category)) return "◆";
        if ("Travel".equals(category)) return "✈";
        if ("Work".equals(category)) return "▣";
        if ("Bills".equals(category)) return "₴";
        return "•";
    }

    public static String categoryLabel(Context context, String category) {
        boolean uk = LanguageManager.isUk(context);
        if ("Personal".equals(category)) return uk ? "Особисте" : "Personal";
        if ("Shopping".equals(category)) return uk ? "Покупки" : "Shopping";
        if ("Travel".equals(category)) return uk ? "Подорож" : "Travel";
        if ("Work".equals(category)) return uk ? "Робота" : "Work";
        if ("Bills".equals(category)) return uk ? "Платежі" : "Bills";
        return uk ? "Інше" : "Other";
    }
}
