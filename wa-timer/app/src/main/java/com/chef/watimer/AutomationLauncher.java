package com.chef.watimer;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.PowerManager;

public final class AutomationLauncher {
    private AutomationLauncher() {}

    public static boolean canInteractNow(Context context) {
        KeyguardManager km = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        return !km.isDeviceLocked() && pm.isInteractive();
    }

    public static boolean launchWhatsApp(Context context, ScheduledMessage item) {
        String pkg = item.useBusiness ? "com.whatsapp.w4b" : "com.whatsapp";
        PackageManager pm = context.getPackageManager();
        Intent launch = pm.getLaunchIntentForPackage(pkg);
        if (launch == null) return false;

        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        try {
            context.startActivity(launch);
            AutomationPrefs.markStartedIfNeeded(context);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
