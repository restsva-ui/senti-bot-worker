package com.remindit.app;

import android.content.Context;
import android.net.Uri;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

public final class OcrHelper {
    public interface Callback {
        void onSuccess(String text);
        void onError(Exception error);
    }

    private OcrHelper() {}

    public static void recognize(Context context, Uri uri, Callback callback) {
        try {
            InputImage image = InputImage.fromFilePath(context, uri);
            TextRecognizer recognizer =
                    TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);

            recognizer.process(image)
                    .addOnSuccessListener(result -> {
                        callback.onSuccess(result.getText());
                        recognizer.close();
                    })
                    .addOnFailureListener(error -> {
                        callback.onError(error);
                        recognizer.close();
                    });
        } catch (Exception error) {
            callback.onError(error);
        }
    }
}
