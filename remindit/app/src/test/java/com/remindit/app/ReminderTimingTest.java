package com.remindit.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.util.List;

public class ReminderTimingTest {
    private static final long MINUTE = 60_000L;

    @Test
    public void appointmentGetsUsefulDefaults() {
        ReminderTiming.Defaults defaults = ReminderTiming.defaultsFor("appointment");
        assertEquals(120, defaults.leadMinutes);
        assertEquals(1440, defaults.secondLeadMinutes);
        assertEquals(30, defaults.followUpMinutes);
    }

    @Test
    public void oneTimeReminderBuildsLeadEventAndTwoFollowUps() {
        Reminder reminder = new Reminder();
        reminder.remindAt = 2_000_000_000_000L;
        reminder.leadMinutes = 120;
        reminder.secondLeadMinutes = 1440;
        reminder.followUpMinutes = 30;

        List<ReminderTiming.Alert> alerts = ReminderTiming.alerts(reminder);
        assertEquals(5, alerts.size());
        assertEquals(reminder.remindAt - 1440 * MINUTE, alerts.get(0).at);
        assertEquals(ReminderTiming.STAGE_SECONDARY, alerts.get(0).stage);
        assertEquals(reminder.remindAt, alerts.get(2).at);
        assertEquals(ReminderTiming.STAGE_EVENT, alerts.get(2).stage);
        assertEquals(reminder.remindAt + 60 * MINUTE, alerts.get(4).at);
    }

    @Test
    public void duplicateLeadTimesDoNotCreateDuplicateAlarms() {
        Reminder reminder = new Reminder();
        reminder.remindAt = 2_000_000_000_000L;
        reminder.leadMinutes = 60;
        reminder.secondLeadMinutes = 60;

        List<ReminderTiming.Alert> alerts = ReminderTiming.alerts(reminder);
        assertEquals(2, alerts.size());
        assertEquals(ReminderTiming.STAGE_PRIMARY, alerts.get(0).stage);
        assertEquals(ReminderTiming.STAGE_EVENT, alerts.get(1).stage);
    }

    @Test
    public void repeatingReminderDoesNotScheduleFollowUps() {
        Reminder reminder = new Reminder();
        reminder.remindAt = 2_000_000_000_000L;
        reminder.leadMinutes = 10;
        reminder.followUpMinutes = 15;
        reminder.repeatMode = Reminder.REPEAT_DAILY;

        List<ReminderTiming.Alert> alerts = ReminderTiming.alerts(reminder);
        assertEquals(2, alerts.size());
        assertEquals(ReminderTiming.STAGE_PRIMARY, alerts.get(0).stage);
        assertEquals(ReminderTiming.STAGE_EVENT, alerts.get(1).stage);
    }
}
