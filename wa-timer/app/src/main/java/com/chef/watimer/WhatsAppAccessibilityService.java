package com.chef.watimer;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.Intent;
import android.graphics.Rect;
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
            if (TargetPickerPrefs.isActive(WhatsAppAccessibilityService.this)) {
                processTargetPicker();
            } else {
                processPending();
            }
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
        if (AutomationPrefs.getPendingId(this) != -1L || TargetPickerPrefs.isActive(this)) {
            queue(250);
        }
    }

    @Override public void onInterrupt() {}

    private void queue(long delayMs) {
        if (scheduled) handler.removeCallbacks(processor);
        scheduled = true;
        handler.postDelayed(processor, delayMs);
    }

    private void processTargetPicker() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            queue(500);
            return;
        }

        String expectedPkg = TargetPickerPrefs.useBusiness(this) ? "com.whatsapp.w4b" : "com.whatsapp";
        CharSequence pkgCs = root.getPackageName();
        if (pkgCs == null || !expectedPkg.equals(pkgCs.toString())) {
            return;
        }

        AccessibilityNodeInfo entry = firstByViewId(root, expectedPkg + ":id/entry");
        if (entry == null || !entry.isVisibleToUser()) {
            return;
        }

        String title = findChatTitle(root, expectedPkg);
        if (title == null || title.trim().isEmpty()) {
            queue(350);
            return;
        }

        TargetPickerPrefs.complete(this, title.trim());
        handler.postDelayed(() -> {
            Intent back = new Intent(WhatsAppAccessibilityService.this, MainActivity.class);
            back.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK |
                    Intent.FLAG_ACTIVITY_CLEAR_TOP |
                    Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(back);
        }, 250);
    }

    private String findChatTitle(AccessibilityNodeInfo root, String pkg) {
        List<String> titleIds = Arrays.asList(
                pkg + ":id/conversation_contact_name",
                pkg + ":id/conversation_title",
                pkg + ":id/contact_name",
                pkg + ":id/toolbar_title",
                pkg + ":id/title"
        );

        for (String id : titleIds) {
            AccessibilityNodeInfo n = firstByViewId(root, id);
            String text = extractFirstText(n);
            if (isUsableTitle(text)) return text;
        }

        List<AccessibilityNodeInfo> all = new ArrayList<>();
        collect(root, all);
        int maxTop = Math.round(getResources().getDisplayMetrics().heightPixels * 0.28f);
        int minTop = dp(28);
        AccessibilityNodeInfo best = null;
        int bestTop = Integer.MAX_VALUE;
        int bestLeft = Integer.MAX_VALUE;

        for (AccessibilityNodeInfo n : all) {
            if (!n.isVisibleToUser() || n.isEditable()) continue;
            String text = n.getText() == null ? "" : n.getText().toString().trim();
            if (!isUsableTitle(text)) continue;

            Rect r = new Rect();
            n.getBoundsInScreen(r);
            if (r.top < minTop || r.top > maxTop || r.width() < dp(45)) continue;

            if (r.top < bestTop || (r.top == bestTop && r.left < bestLeft)) {
                best = n;
                bestTop = r.top;
                bestLeft = r.left;
            }
        }

        return best == null || best.getText() == null ? null : best.getText().toString().trim();
    }

    private String extractFirstText(AccessibilityNodeInfo node) {
        if (node == null) return null;
        CharSequence own = node.getText();
        if (own != null && !own.toString().trim().isEmpty()) return own.toString().trim();
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            String nested = extractFirstText(child);
            if (nested != null && !nested.trim().isEmpty()) return nested.trim();
        }
        return null;
    }

    private boolean isUsableTitle(String text) {
        if (text == null) return false;
        String t = text.trim();
        if (t.isEmpty() || t.length() > 120) return false;

        String lower = t.toLowerCase(Locale.ROOT);
        if (lower.equals("whatsapp") || lower.equals("whatsapp business") ||
                lower.equals("пошук") || lower.equals("search") || lower.equals("поиск") ||
                lower.equals("надіслати") || lower.equals("send") || lower.equals("отправить") ||
                lower.equals("онлайн") || lower.equals("online") || lower.equals("в мережі") ||
                lower.equals("друкує…") || lower.equals("typing…") || lower.equals("печатает…")) {
            return false;
        }

        return !t.matches("^\\d{1,2}:\\d{2}$");
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
                AccessibilityNodeInfo alreadyVisibleSearch = findSearchEditor(root, expectedPkg);
                if (alreadyVisibleSearch != null) {
                    focusOrClick(alreadyVisibleSearch);
                    AutomationPrefs.setStage(this, 1);
                    queue(180);
                } else if (clickSearch(root, expectedPkg)) {
                    AutomationPrefs.setStage(this, 1);
                    queue(500);
                } else {
                    int attempts = AutomationPrefs.incrementAttempts(this);
                    if (attempts <= 4) {
                        performGlobalAction(GLOBAL_ACTION_BACK);
                        queue(600);
                    } else {
                        fail(item, "Не знайдено поле пошуку WhatsApp");
                    }
                }
                break;
            case 1:
                if (setSearchText(root, expectedPkg, item.groupName)) {
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
                NotificationHelper.show(this, "WA Timer", "Надіслано в «" + item.groupName + "»");
                if (item.exitAfterSend) performGlobalAction(GLOBAL_ACTION_HOME);
                break;
            default:
                AutomationPrefs.clear(this);
        }
    }

    private boolean clickSearch(AccessibilityNodeInfo root, String pkg) {
        AccessibilityNodeInfo editor = findSearchEditor(root, pkg);
        if (editor != null) {
            return focusOrClick(editor);
        }

        List<String> ids = Arrays.asList(
                pkg + ":id/menuitem_search",
                pkg + ":id/search",
                pkg + ":id/search_input",
                pkg + ":id/search_src_text",
                pkg + ":id/search_edit_text",
                pkg + ":id/search_bar"
        );
        for (String id : ids) {
            AccessibilityNodeInfo n = firstByViewId(root, id);
            if (n != null && focusOrClick(n)) return true;
        }

        List<AccessibilityNodeInfo> all = new ArrayList<>();
        collect(root, all);
        int maxTop = Math.round(getResources().getDisplayMetrics().heightPixels * 0.34f);
        for (AccessibilityNodeInfo n : all) {
            if (!n.isVisibleToUser()) continue;
            Rect r = new Rect();
            n.getBoundsInScreen(r);
            if (r.top > maxTop) continue;
            if (looksLikeSearch(n) && focusOrClick(n)) return true;
        }
        return false;
    }

    private AccessibilityNodeInfo findSearchEditor(AccessibilityNodeInfo root, String pkg) {
        List<String> ids = Arrays.asList(
                pkg + ":id/search_input",
                pkg + ":id/search_src_text",
                pkg + ":id/search_edit_text",
                pkg + ":id/search"
        );
        for (String id : ids) {
            AccessibilityNodeInfo n = firstByViewId(root, id);
            if (n != null && n.isVisibleToUser() && n.isEditable()) return n;
        }

        List<AccessibilityNodeInfo> all = new ArrayList<>();
        collect(root, all);
        int screenHeight = getResources().getDisplayMetrics().heightPixels;
        int screenWidth = getResources().getDisplayMetrics().widthPixels;
        int maxTop = Math.round(screenHeight * 0.34f);
        AccessibilityNodeInfo fallback = null;
        int bestTop = Integer.MAX_VALUE;

        for (AccessibilityNodeInfo n : all) {
            if (!n.isVisibleToUser() || !n.isEditable()) continue;
            Rect r = new Rect();
            n.getBoundsInScreen(r);
            if (r.top > maxTop) continue;
            if (looksLikeSearch(n)) return n;
            if (r.width() >= Math.round(screenWidth * 0.55f) && r.top < bestTop) {
                fallback = n;
                bestTop = r.top;
            }
        }
        return fallback;
    }

    private boolean looksLikeSearch(AccessibilityNodeInfo node) {
        StringBuilder s = new StringBuilder();
        if (node.getText() != null) s.append(node.getText()).append(' ');
        if (node.getContentDescription() != null) s.append(node.getContentDescription()).append(' ');
        if (node.getHintText() != null) s.append(node.getHintText()).append(' ');
        if (node.getViewIdResourceName() != null) s.append(node.getViewIdResourceName());
        String value = s.toString().toLowerCase(Locale.ROOT);
        return value.contains("пошук") || value.contains("search") || value.contains("поиск");
    }

    private boolean setSearchText(AccessibilityNodeInfo root, String pkg, String text) {
        AccessibilityNodeInfo edit = findSearchEditor(root, pkg);
        if (edit == null) edit = findEditable(root, true);
        if (edit == null) return false;
        focusOrClick(edit);
        return setText(edit, text);
    }

    private boolean clickExactGroup(AccessibilityNodeInfo root, String groupName) {
        List<AccessibilityNodeInfo> all = new ArrayList<>();
        collect(root, all);
        for (AccessibilityNodeInfo n : all) {
            CharSequence t = n.getText();
            if (t == null || n.isEditable() || !n.isVisibleToUser()) continue;
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
                Rect r = new Rect();
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

    private boolean focusOrClick(AccessibilityNodeInfo node) {
        if (node == null) return false;
        boolean ok = false;
        try {
            ok = node.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
        } catch (Exception ignored) {}
        if (node.isClickable()) {
            try {
                ok = node.performAction(AccessibilityNodeInfo.ACTION_CLICK) || ok;
            } catch (Exception ignored) {}
        }
        if (!ok) ok = clickNodeOrParent(node);
        return ok || node.isEditable();
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

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void fail(ScheduledMessage item, String reason) {
        item.lastStatus = reason;
        ScheduleStore.upsert(this, item);
        AutomationPrefs.clear(this);
        NotificationHelper.show(this, "WA Timer", reason);
    }
}
