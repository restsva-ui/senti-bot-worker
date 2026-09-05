package com.chef.watimer;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

public class WhatsAppAccessibilityService extends AccessibilityService {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean scheduled;

    private final Runnable processor = new Runnable() {
        @Override public void run() {
            scheduled = false;
            processPending();
        }
    };

    @Override
    protected void onServiceConnected() {
        AccessibilityServiceInfo info = getServiceInfo();
        info.flags |= AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
        info.flags |= AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
        info.eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED |
                AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED |
                AccessibilityEvent.TYPE_VIEW_FOCUSED |
                AccessibilityEvent.TYPE_WINDOWS_CHANGED;
        info.notificationTimeout = 100;
        setServiceInfo(info);
        queue(300);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (AutomationPrefs.getPendingId(this) != -1L) queue(250);
    }

    @Override public void onInterrupt() {}

    private void queue(long delayMs) {
        if (scheduled) handler.removeCallbacks(processor);
        scheduled = true;
        handler.postDelayed(processor, delayMs);
    }

    private void processPending() {
        long id = AutomationPrefs.getPendingId(this);
        if (id == -1L) return;
        ScheduledMessage item = ScheduleStore.get(this, id);
        if (item == null) {
            AutomationPrefs.clear(this);
            return;
        }

        long started = AutomationPrefs.getStarted(this);
        if (started > 0 && System.currentTimeMillis() - started > 45_000L) {
            fail(item, "Помилка: тайм-аут автоматизації");
            return;
        }

        if (!AutomationLauncher.canInteractNow(this)) {
            queue(1000);
            return;
        }

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            if (AutomationPrefs.getStage(this) == 0) AutomationLauncher.launchWhatsApp(this, item);
            queue(700);
            return;
        }

        CharSequence pkgCs = root.getPackageName();
        String expectedPkg = item.useBusiness ? "com.whatsapp.w4b" : "com.whatsapp";
        if (pkgCs == null || !expectedPkg.equals(pkgCs.toString())) {
            if (AutomationPrefs.getStage(this) == 0) {
                AutomationLauncher.launchWhatsApp(this, item);
                queue(800);
            } else {
                queue(500);
            }
            return;
        }

        int stage = AutomationPrefs.getStage(this);
        switch (stage) {
            case 0:
                if (clickSearch(root, expectedPkg)) {
                    AutomationPrefs.setStage(this, 1);
                    queue(500);
                } else {
                    int attempts = AutomationPrefs.incrementAttempts(this);
                    if (attempts <= 4) {
                        performGlobalAction(GLOBAL_ACTION_BACK);
                        queue(600);
                    } else {
                        fail(item, "Не знайдено кнопку пошуку WhatsApp");
                    }
                }
                break;
            case 1:
                if (setSearchText(root, item.groupName)) {
                    AutomationPrefs.setStage(this, 2);
                    queue(900);
                } else {
                    queue(400);
                }
                break;
            case 2:
                if (clickExactGroup(root, item.groupName)) {
                    AutomationPrefs.setStage(this, 3);
                    queue(900);
                } else {
                    queue(500);
                }
                break;
            case 3:
                if (setMessageText(root, expectedPkg, item.message)) {
                    AutomationPrefs.setStage(this, 4);
                    queue(500);
                } else {
                    queue(450);
                }
                break;
            case 4:
                if (clickSend(root, expectedPkg)) {
                    AutomationPrefs.setStage(this, 5);
                    queue(700);
                } else {
                    queue(450);
                }
                break;
            case 5:
                item.lastStatus = "Надіслано";
                ScheduleStore.upsert(this, item);
                AutomationPrefs.clear(this);
                NotificationHelper.show(this, "WA Timer", "Надіслано в групу «" + item.groupName + "»");
                if (item.exitAfterSend) performGlobalAction(GLOBAL_ACTION_HOME);
                break;
            default:
                AutomationPrefs.clear(this);
        }
    }

    private boolean clickSearch(AccessibilityNodeInfo root, String pkg) {
        List<String> ids = Arrays.asList(
                pkg + ":id/menuitem_search",
                pkg + ":id/search"
        );
        for (String id : ids) {
            AccessibilityNodeInfo n = firstByViewId(root, id);
            if (n != null && clickNodeOrParent(n)) return true;
        }
        return clickByDescription(root, Arrays.asList("Пошук", "Search", "Поиск"));
    }

    private boolean setSearchText(AccessibilityNodeInfo root, String text) {
        AccessibilityNodeInfo edit = findEditable(root, true);
        return edit != null && setText(edit, text);
    }

    private boolean clickExactGroup(AccessibilityNodeInfo root, String groupName) {
        List<AccessibilityNodeInfo> all = new ArrayList<>();
        collect(root, all);
        for (AccessibilityNodeInfo n : all) {
            CharSequence t = n.getText();
            if (t == null || n.isEditable()) continue;
            if (t.toString().trim().equalsIgnoreCase(groupName.trim())) {
                if (clickNodeOrParent(n)) return true;
            }
        }
        return false;
    }

    private boolean setMessageText(AccessibilityNodeInfo root, String pkg, String message) {
        AccessibilityNodeInfo byId = firstByViewId(root, pkg + ":id/entry");
        if (byId != null && byId.isEditable()) return setText(byId, message);
        AccessibilityNodeInfo edit = findEditable(root, false);
        return edit != null && setText(edit, message);
    }

    private boolean clickSend(AccessibilityNodeInfo root, String pkg) {
        AccessibilityNodeInfo byId = firstByViewId(root, pkg + ":id/send");
        if (byId != null && clickNodeOrParent(byId)) return true;
        return clickByDescription(root, Arrays.asList("Надіслати", "Send", "Отправить"));
    }

    private AccessibilityNodeInfo firstByViewId(AccessibilityNodeInfo root, String id) {
        try {
            List<AccessibilityNodeInfo> found = root.findAccessibilityNodeInfosByViewId(id);
            return found == null || found.isEmpty() ? null : found.get(0);
        } catch (Exception e) {
            return null;
        }
    }

    private AccessibilityNodeInfo findEditable(AccessibilityNodeInfo root, boolean preferTop) {
        List<AccessibilityNodeInfo> all = new ArrayList<>();
        collect(root, all);
        AccessibilityNodeInfo candidate = null;
        int bestTop = Integer.MAX_VALUE;
        for (AccessibilityNodeInfo n : all) {
            if (!n.isEditable() || !n.isVisibleToUser()) continue;
            if (n.isFocused()) return n;
            if (!preferTop && candidate == null) candidate = n;
            if (preferTop) {
                android.graphics.Rect r = new android.graphics.Rect();
                n.getBoundsInScreen(r);
                if (r.top < bestTop) {
                    bestTop = r.top;
                    candidate = n;
                }
            }
        }
        return candidate;
    }

    private boolean setText(AccessibilityNodeInfo node, String text) {
        Bundle args = new Bundle();
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
        return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
    }

    private boolean clickByDescription(AccessibilityNodeInfo root, List<String> names) {
        List<AccessibilityNodeInfo> all = new ArrayList<>();
        collect(root, all);
        for (AccessibilityNodeInfo n : all) {
            String d = n.getContentDescription() == null ? "" : n.getContentDescription().toString().trim();
            String t = n.getText() == null ? "" : n.getText().toString().trim();
            for (String name : names) {
                if (d.equalsIgnoreCase(name) || t.equalsIgnoreCase(name)) {
                    if (clickNodeOrParent(n)) return true;
                }
            }
        }
        return false;
    }

    private boolean clickNodeOrParent(AccessibilityNodeInfo node) {
        AccessibilityNodeInfo cur = node;
        for (int i = 0; i < 6 && cur != null; i++) {
            if (cur.isClickable() && cur.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true;
            cur = cur.getParent();
        }
        return false;
    }

    private void collect(AccessibilityNodeInfo node, List<AccessibilityNodeInfo> out) {
        if (node == null) return;
        out.add(node);
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) collect(child, out);
        }
    }

    private void fail(ScheduledMessage item, String reason) {
        item.lastStatus = reason;
        ScheduleStore.upsert(this, item);
        AutomationPrefs.clear(this);
        NotificationHelper.show(this, "WA Timer", reason);
    }
}
