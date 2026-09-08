package com.remindit.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.concurrent.TimeUnit;

public class DateDetectorTest {
    @Test
    public void detectsUkrainianRelativeMinutes() {
        long before = System.currentTimeMillis();
        long detected = DateDetector.detect("Нагадай через 20 хвилин зателефонувати");
        long after = System.currentTimeMillis();

        assertTrue(detected >= before + TimeUnit.MINUTES.toMillis(19));
        assertTrue(detected <= after + TimeUnit.MINUTES.toMillis(20));
    }

    @Test
    public void detectsEnglishRelativeHours() {
        long before = System.currentTimeMillis();
        long detected = DateDetector.detect("Reply in 2 hours");
        long after = System.currentTimeMillis();

        assertTrue(detected >= before + TimeUnit.MINUTES.toMillis(119));
        assertTrue(detected <= after + TimeUnit.HOURS.toMillis(2));
    }

    @Test
    public void detectsDayAfterTomorrowWithTime() {
        ZoneId zone = ZoneId.systemDefault();
        LocalDate expectedDate = LocalDate.now(zone).plusDays(2);
        long detected = DateDetector.detect("Запис післязавтра о 15:30");
        LocalDateTime value = LocalDateTime.ofInstant(Instant.ofEpochMilli(detected), zone);

        assertEquals(expectedDate, value.toLocalDate());
        assertEquals(15, value.getHour());
        assertEquals(30, value.getMinute());
    }

    @Test
    public void detectsNextUkrainianWeekday() {
        ZoneId zone = ZoneId.systemDefault();
        long detected = DateDetector.detect("зустріч у п’ятницю о 09:45");
        LocalDateTime value = LocalDateTime.ofInstant(Instant.ofEpochMilli(detected), zone);

        assertEquals(DayOfWeek.FRIDAY, value.getDayOfWeek());
        assertEquals(9, value.getHour());
        assertEquals(45, value.getMinute());
        assertTrue(value.toLocalDate().isAfter(LocalDate.now(zone)));
    }
}
