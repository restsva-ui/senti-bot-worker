package com.remindit.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Paint;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import com.googlecode.tesseract.android.TessBaseAPI;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

public final class OcrHelper {
    private static final long MIN_MODEL_BYTES = 500_000L;
    private static final String[] LANGS = {"ukr", "rus", "eng"};

    public interface Callback {
        void onSuccess(String recognizedText);
        void onError(Exception error);
    }

    private OcrHelper() {}

    public static void recognize(Context context, Uri uri, Callback callback) {
        Context app = context.getApplicationContext();
        new Thread(() -> recognizeMultilingual(app, uri, callback), "RemindIt-OCR").start();
    }

    private static void recognizeMultilingual(Context context, Uri uri, Callback callback) {
        TessBaseAPI tess = null;
        Bitmap original = null;
        Bitmap prepared = null;
        try {
            File dataDir = new File(context.getFilesDir(), "tesseract");
            File tessData = new File(dataDir, "tessdata");
            if (!tessData.exists() && !tessData.mkdirs()) {
                throw new IllegalStateException("Cannot create OCR directory");
            }

            for (String lang : LANGS) {
                ensureBundledModel(context, tessData, lang);
            }

            try (InputStream stream = context.getContentResolver().openInputStream(uri)) {
                if (stream == null) throw new IllegalStateException("Cannot open shared image");
                BitmapFactory.Options options = new BitmapFactory.Options();
                options.inPreferredConfig = Bitmap.Config.ARGB_8888;
                original = BitmapFactory.decodeStream(stream, null, options);
            }
            if (original == null) throw new IllegalStateException("Cannot decode shared image");

            prepared = prepareForOcr(original);

            tess = new TessBaseAPI();
            if (!tess.init(dataDir.getAbsolutePath(), "ukr+rus+eng")) {
                throw new IllegalStateException("Cannot initialize multilingual OCR");
            }
            tess.setImage(prepared);
            String raw = tess.getUTF8Text();
            String cleaned = cleanAndValidate(raw == null ? "" : raw);
            postSuccess(callback, cleaned);
        } catch (Exception e) {
            postError(callback, e);
        } finally {
            if (tess != null) tess.recycle();
            if (prepared != null && prepared != original && !prepared.isRecycled()) prepared.recycle();
            if (original != null && !original.isRecycled()) original.recycle();
        }
    }

    private static Bitmap prepareForOcr(Bitmap source) {
        Bitmap working = source;

        // Phone screenshots often contain a status bar and navigation bar that pollute OCR.
        if (source.getHeight() > source.getWidth() * 1.45f) {
            int top = Math.max(0, Math.round(source.getHeight() * 0.045f));
            int bottom = Math.max(top + 1, Math.round(source.getHeight() * 0.975f));
            working = Bitmap.createBitmap(source, 0, top, source.getWidth(), bottom - top);
        }

        int targetWidth = working.getWidth();
        if (targetWidth < 1500) targetWidth = Math.min(2200, targetWidth * 2);
        Bitmap scaled = working;
        if (targetWidth != working.getWidth()) {
            int targetHeight = Math.max(1, Math.round(working.getHeight() * (targetWidth / (float) working.getWidth())));
            scaled = Bitmap.createScaledBitmap(working, targetWidth, targetHeight, true);
            if (working != source && working != scaled) working.recycle();
        }

        Bitmap gray = Bitmap.createBitmap(scaled.getWidth(), scaled.getHeight(), Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(gray);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        ColorMatrix matrix = new ColorMatrix();
        matrix.setSaturation(0f);
        // Mild contrast boost; enough for screenshots without destroying thin text.
        float contrast = 1.18f;
        float translate = (-0.5f * contrast + 0.5f) * 255f;
        matrix.postConcat(new ColorMatrix(new float[]{
                contrast, 0, 0, 0, translate,
                0, contrast, 0, 0, translate,
                0, 0, contrast, 0, translate,
                0, 0, 0, 1, 0
        }));
        paint.setColorFilter(new ColorMatrixColorFilter(matrix));
        canvas.drawBitmap(scaled, 0, 0, paint);
        if (scaled != source && !scaled.isRecycled()) scaled.recycle();
        return gray;
    }

    private static String cleanAndValidate(String raw) {
        if (raw == null || raw.trim().isEmpty()) return "";
        String normalized = raw.replace('\r', '\n')
                .replace('’', '\'')
                .replace('`', '\'')
                .replaceAll("[\\t ]+", " ");

        List<String> good = new ArrayList<>();
        int totalLetters = 0;
        int keptLetters = 0;

        for (String part : normalized.split("\\n+")) {
            String line = part.trim().replaceAll("\\s+", " ");
            totalLetters += letterCount(line);
            if (!isReadableLine(line)) continue;
            good.add(line);
            keptLetters += letterCount(line);
        }

        if (good.isEmpty() || keptLetters < 12) return "";

        // If almost everything was rejected, don't invent a meaning from OCR garbage.
        if (totalLetters >= 40 && keptLetters * 100 / Math.max(1, totalLetters) < 24) return "";

        StringBuilder out = new StringBuilder();
        for (String line : good) {
            if (out.length() > 0) out.append('\n');
            out.append(line);
            if (out.length() > 2200) break;
        }
        return out.toString().trim();
    }

    private static boolean isReadableLine(String line) {
        if (line == null || line.length() < 4) return false;
        String lower = line.toLowerCase();
        if (lower.matches(".*(volte|wifi|wi-fi|lifecell|kyivstar|vodafone|\\b4g\\b|\\b5g\\b|\\d{1,3}%|мб/с|kb/s).*")) return false;

        int letters = 0, cyr = 0, latin = 0, digits = 0, weird = 0;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (Character.isLetter(c)) {
                letters++;
                Character.UnicodeBlock block = Character.UnicodeBlock.of(c);
                boolean isCyr = block == Character.UnicodeBlock.CYRILLIC
                        || block == Character.UnicodeBlock.CYRILLIC_SUPPLEMENTARY
                        || block == Character.UnicodeBlock.CYRILLIC_EXTENDED_A
                        || block == Character.UnicodeBlock.CYRILLIC_EXTENDED_B;
                if (isCyr) cyr++; else latin++;
            } else if (Character.isDigit(c)) {
                digits++;
            } else if (!Character.isWhitespace(c)
                    && ".,!?—–-:;()[]{}«»'\"/\\@#₴$€%+&_=…•".indexOf(c) < 0) {
                weird++;
            }
        }
        if (letters < 4) return false;
        if (weird > Math.max(3, line.length() / 9)) return false;
        if (digits > letters * 2 && letters < 10) return false;

        // Mixed Cyrillic/Latin inside a supposedly normal sentence is the main symptom
        // of the broken OCR seen in the previous build.
        if (cyr >= 6 && latin >= 4) {
            int minority = Math.min(cyr, latin);
            if (minority * 100 / Math.max(1, letters) > 22) return false;
        }

        String[] words = line.split("\\s+");
        int oneLetter = 0;
        int alphaWords = 0;
        for (String word : words) {
            String clean = word.replaceAll("[^\\p{L}]", "");
            if (clean.isEmpty()) continue;
            alphaWords++;
            if (clean.length() == 1) oneLetter++;
        }
        if (alphaWords >= 4 && oneLetter * 100 / alphaWords > 35) return false;
        return true;
    }

    private static int letterCount(String value) {
        int count = 0;
        if (value == null) return 0;
        for (int i = 0; i < value.length(); i++) if (Character.isLetter(value.charAt(i))) count++;
        return count;
    }

    private static void ensureBundledModel(Context context, File tessData, String lang) throws Exception {
        File target = new File(tessData, lang + ".traineddata");
        if (target.exists() && target.length() >= MIN_MODEL_BYTES) return;

        File temp = new File(tessData, lang + ".traineddata.tmp");
        try (InputStream in = context.getAssets().open("tessdata/" + lang + ".traineddata");
             FileOutputStream out = new FileOutputStream(temp)) {
            byte[] buffer = new byte[32 * 1024];
            int count;
            while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
            out.flush();
        }
        if (temp.length() < MIN_MODEL_BYTES) {
            temp.delete();
            throw new IllegalStateException("Bundled OCR model is incomplete: " + lang);
        }
        if (target.exists()) target.delete();
        if (!temp.renameTo(target)) throw new IllegalStateException("Cannot install OCR model: " + lang);
    }

    private static void postSuccess(Callback callback, String text) {
        new Handler(Looper.getMainLooper()).post(() -> callback.onSuccess(text));
    }

    private static void postError(Callback callback, Exception error) {
        new Handler(Looper.getMainLooper()).post(() -> callback.onError(error));
    }
}
