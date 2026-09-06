package com.remindit.app;

import android.content.Context;
import android.net.Uri;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class OriginalStore {
    private static final Pattern URL_PATTERN = Pattern.compile("https?://[^\\s<>\"']+", Pattern.CASE_INSENSITIVE);

    private OriginalStore() {}

    public static String saveImage(Context context, Uri uri) {
        if (context == null || uri == null) return null;
        File dir = new File(context.getFilesDir(), "originals");
        if (!dir.exists() && !dir.mkdirs()) return null;

        String name = "original_" + System.currentTimeMillis() + ".jpg";
        File target = new File(dir, name);

        try (InputStream in = context.getContentResolver().openInputStream(uri);
             FileOutputStream out = new FileOutputStream(target)) {
            if (in == null) return null;
            byte[] buffer = new byte[32 * 1024];
            int count;
            while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
            out.flush();
            return target.getAbsolutePath();
        } catch (Exception e) {
            try { target.delete(); } catch (Exception ignored) {}
            return null;
        }
    }

    public static String firstUrl(String text) {
        if (text == null) return null;
        Matcher matcher = URL_PATTERN.matcher(text);
        if (!matcher.find()) return null;
        String url = matcher.group();
        while (url.endsWith(")") || url.endsWith("]") || url.endsWith("}")
                || url.endsWith(".") || url.endsWith(",") || url.endsWith(";")) {
            url = url.substring(0, url.length() - 1);
        }
        return url;
    }

    public static String removeUrls(String text) {
        if (text == null) return "";
        return URL_PATTERN.matcher(text).replaceAll(" ").replaceAll("\\s+", " ").trim();
    }
}
