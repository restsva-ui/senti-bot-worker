package com.remindit.app;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;

public final class ReminderSound {
    private static final int SAMPLE_RATE = 44100;

    private ReminderSound() {}

    public static void play() {
        new Thread(() -> {
            AudioTrack track = null;
            try {
                short[] pcm = buildChime();
                AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build();
                AudioFormat format = new AudioFormat.Builder()
                        .setSampleRate(SAMPLE_RATE)
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build();

                track = new AudioTrack.Builder()
                        .setAudioAttributes(attrs)
                        .setAudioFormat(format)
                        .setBufferSizeInBytes(pcm.length * 2)
                        .setTransferMode(AudioTrack.MODE_STATIC)
                        .build();
                track.write(pcm, 0, pcm.length);
                track.play();
                Thread.sleep(1150);
            } catch (Exception ignored) {
            } finally {
                if (track != null) {
                    try { track.stop(); } catch (Exception ignored) {}
                    try { track.release(); } catch (Exception ignored) {}
                }
            }
        }, "RemindIt-Chime").start();
    }

    private static short[] buildChime() {
        double duration = 0.95;
        int samples = (int) (SAMPLE_RATE * duration);
        short[] out = new short[samples];

        addNote(out, 0.00, 0.30, 659.25, 0.34);   // E5
        addNote(out, 0.15, 0.36, 880.00, 0.31);   // A5
        addNote(out, 0.32, 0.42, 1174.66, 0.28);  // D6
        addNote(out, 0.55, 0.28, 1760.00, 0.15);  // A6 sparkle
        return out;
    }

    private static void addNote(short[] out, double startSec, double lengthSec, double frequency, double volume) {
        int start = (int) (startSec * SAMPLE_RATE);
        int length = (int) (lengthSec * SAMPLE_RATE);
        for (int i = 0; i < length && start + i < out.length; i++) {
            double t = i / (double) SAMPLE_RATE;
            double attack = Math.min(1.0, i / (SAMPLE_RATE * 0.018));
            double decay = Math.exp(-5.0 * i / Math.max(1.0, length));
            double wave = Math.sin(2.0 * Math.PI * frequency * t)
                    + 0.22 * Math.sin(2.0 * Math.PI * frequency * 2.0 * t);
            int mixed = out[start + i] + (int) (Short.MAX_VALUE * volume * attack * decay * wave / 1.22);
            mixed = Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, mixed));
            out[start + i] = (short) mixed;
        }
    }
}
