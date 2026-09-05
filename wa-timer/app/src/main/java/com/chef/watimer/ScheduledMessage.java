package com.chef.watimer;

import org.json.JSONException;
import org.json.JSONObject;

public class ScheduledMessage {
    public static final String REPEAT_ONCE = "ONCE";
    public static final String REPEAT_DAILY = "DAILY";
    public static final String REPEAT_WEEKDAYS = "WEEKDAYS";

    public long id;
    public String groupName;
    public String message;
    public long triggerAtMillis;
    public String repeatMode;
    public boolean exitAfterSend;
    public boolean useBusiness;
    public boolean enabled;
    public String lastStatus;

    public ScheduledMessage() {
        id = System.currentTimeMillis();
        groupName = "";
        message = "";
        repeatMode = REPEAT_ONCE;
        exitAfterSend = true;
        useBusiness = false;
        enabled = true;
        lastStatus = "Заплановано";
    }

    public JSONObject toJson() throws JSONException {
        JSONObject o = new JSONObject();
        o.put("id", id);
        o.put("groupName", groupName);
        o.put("message", message);
        o.put("triggerAtMillis", triggerAtMillis);
        o.put("repeatMode", repeatMode);
        o.put("exitAfterSend", exitAfterSend);
        o.put("useBusiness", useBusiness);
        o.put("enabled", enabled);
        o.put("lastStatus", lastStatus);
        return o;
    }

    public static ScheduledMessage fromJson(JSONObject o) {
        ScheduledMessage m = new ScheduledMessage();
        m.id = o.optLong("id", System.currentTimeMillis());
        m.groupName = o.optString("groupName", "");
        m.message = o.optString("message", "");
        m.triggerAtMillis = o.optLong("triggerAtMillis", 0L);
        m.repeatMode = o.optString("repeatMode", REPEAT_ONCE);
        m.exitAfterSend = o.optBoolean("exitAfterSend", true);
        m.useBusiness = o.optBoolean("useBusiness", false);
        m.enabled = o.optBoolean("enabled", true);
        m.lastStatus = o.optString("lastStatus", "Заплановано");
        return m;
    }
}
