package com.remindit.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import com.googlecode.tesseract.android.TessBaseAPI;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

public final class OcrHelper {
    private static final long MIN_MODEL_BYTES = 1_000_000L;
    private static final String ASSET_MODEL = "tessdata/ukr.traineddata";

    public interface Callback {
        void onSuccess(String recognizedText);
        void onError(Exception error);
    }

    private OcrHelper() {}

    public static void recognize(Context context, Uri uri, Callback callback) {
        Context app = context.getApplicationContext();
        if (LanguageManager.isUk(app)) {
            recognizeUkrainian(app, uri, callback);
        } else {
            recognizeLatin(app, uri, callback);
        }
    }

    private static void recognizeLatin(Context context, Uri uri, Callback callback) {
        try {
            InputImage input = InputImage.fromFilePath(context, uri);
            TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
            recognizer.process(input)
                    .addOnSuccessListener(result -> {
                        callback.onSuccess(result.getText());
                        recognizer.close();
                    })
                    .addOnFailureListener(error -> {
                        callback.onError(error);
                        recognizer.close();
                    });
        } catch (Exception e) {
            callback.onError(e);
        }
    }

    private static void recognizeUkrainian(Context context, Uri uri, Callback callback) {
        new Thread(() -> {
            TessBaseAPI tess = null;
            Bitmap bitmap = null;
            try {
                File dataDir = new File(context.getFilesDir(), "tesseract");
                File tessData = new File(dataDir, "tessdata");
                if (!tessData.exists() && !tessData.mkdirs()) {
                    throw new IllegalStateException("Cannot create OCR data directory");
                }

                File model = new File(tessData, "ukr.traineddata");
                ensureBundledModel(context, model);

                try (InputStream stream = context.getContentResolver().openInputStream(uri)) {
                    if (stream == null) throw new IllegalStateException("Cannot open shared image");
                    bitmap = BitmapFactory.decodeStream(stream);
                }
                if (bitmap == null) throw new IllegalStateException("Cannot decode shared image");

                tess = new TessBaseAPI();
                if (!tess.init(dataDir.getAbsolutePath(), "ukr")) {
                    throw new IllegalStateException("Cannot initialize Ukrainian OCR");
                }
                tess.setImage(bitmap);
                String text = tess.getUTF8Text();
                postSuccess(callback, text == null ? "" : text.trim());
            } catch (Exception e) {
                postError(callback, e);
            } finally {
                if (tess != null) tess.recycle();
                if (bitmap != null) bitmap.recycle();
            }
        }, "RemindIt-UkrOCR").start();
    }

    private static void ensureBundledModel(Context context, File target) throws Exception {
        if (target.exists() && target.length() >= MIN_MODEL_BYTES) return;

        File temp = new File(target.getParentFile(), target.getName() + ".tmp");
        try (InputStream in = context.getAssets().open(ASSET_MODEL);
             FileOutputStream out = new FileOutputStream(temp)) {
            byte[] buffer = new byte[32 * 1024];
            int count;
            while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
            out.flush();
        }

        if (temp.length() < MIN_MODEL_BYTES) {
            temp.delete();
            throw new IllegalStateException("Bundled Ukrainian OCR model is incomplete");
        }
        if (target.exists()) target.delete();
        if (!temp.renameTo(target)) {
            throw new IllegalStateException("Cannot install bundled Ukrainian OCR model");
        }
    }

    private static void postSuccess(Callback callback, String text) {
        new Handler(Looper.getMainLooper()).post(() -> callback.onSuccess(text));
    }

    private static void postError(Callback callback, Exception error) {
        new Handler(Looper.getMainLooper()).post(() -> callback.onError(error));
    }
}
