package com.remindit.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class ReminderIntentAnalyzerTest {
    @Test
    public void removesDetectedScheduleFromNotificationMeaning() {
        assertEquals(
                "Запис до лікаря",
                ReminderIntentAnalyzer.stripScheduleDetails("Запис до лікаря завтра о 15:30")
        );
        assertEquals(
                "Doctor appointment",
                ReminderIntentAnalyzer.stripScheduleDetails("Doctor appointment day after tomorrow at 09:45")
        );
        assertEquals(
                "Зателефонувати мамі",
                ReminderIntentAnalyzer.stripScheduleDetails("Зателефонувати мамі через 20 хвилин")
        );
    }

    @Test
    public void formatsNaturalUkrainianAppointmentGoal() {
        String subject = ReminderIntentAnalyzer.stripScheduleDetails(
                "Запис до лікаря завтра о 15:30"
        );
        assertEquals(
                "Не пропустити прийом до лікаря",
                ReminderIntentAnalyzer.buildGoal(true, "appointment", subject)
        );
    }

    @Test
    public void avoidsDuplicatingAnActionVerb() {
        assertEquals(
                "Зателефонувати мамі",
                ReminderIntentAnalyzer.buildGoal(true, "call", "Зателефонувати мамі")
        );
        assertEquals(
                "Pay the electricity bill",
                ReminderIntentAnalyzer.buildGoal(false, "payment", "Pay the electricity bill")
        );
    }
}
