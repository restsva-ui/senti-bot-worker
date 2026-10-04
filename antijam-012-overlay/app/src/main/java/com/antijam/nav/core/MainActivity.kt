package com.antijam.nav.core

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import java.io.File

class MainActivity : Activity() {
    companion object {
        private const val CHATGPT_PACKAGE = "com.openai.chatgpt"
    }

    private lateinit var statusText: TextView
    private lateinit var simulationSwitch: Switch
    private lateinit var startButton: Button
    private lateinit var stopButton: Button
    private lateinit var shareChatGptButton: Button
    private lateinit var shareCsvButton: Button
    private var receiverRegistered = false
    private var currentTripPath: String? = null
    private var recording = false

    private val telemetryReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != TrackingService.ACTION_TELEMETRY) return
            renderTelemetry(intent)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
        requestRequiredPermissions()
        refreshShareButtons()
    }

    override fun onStart() {
        super.onStart()
        val filter = IntentFilter(TrackingService.ACTION_TELEMETRY)
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(telemetryReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(telemetryReceiver, filter)
        }
        receiverRegistered = true
        refreshShareButtons()
    }

    override fun onStop() {
        if (receiverRegistered) {
            unregisterReceiver(telemetryReceiver)
            receiverRegistered = false
        }
        super.onStop()
    }

    private fun buildUi(): ScrollView {
        val dp = resources.displayMetrics.density
        fun px(value: Int) = (value * dp).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(px(20), px(24), px(20), px(24))
            setBackgroundColor(Color.rgb(17, 19, 24))
        }

        root.addView(TextView(this).apply {
            text = "AntiJam Nav Core 0.1.2"
            textSize = 28f
            setTextColor(Color.WHITE)
        })
        root.addView(TextView(this).apply {
            text = "GNSS / IMU recorder + GNSS-loss simulator"
            textSize = 15f
            setTextColor(Color.LTGRAY)
            setPadding(0, px(4), 0, px(18))
        })

        startButton = Button(this).apply {
            text = "START TRIP RECORDING"
            setOnClickListener { startTracking() }
        }
        root.addView(startButton, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        stopButton = Button(this).apply {
            text = "STOP"
            isEnabled = false
            setOnClickListener {
                startService(Intent(this@MainActivity, TrackingService::class.java).apply {
                    action = TrackingService.ACTION_STOP
                })
            }
        }
        root.addView(stopButton, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        simulationSwitch = Switch(this).apply {
            text = "SIMULATE GNSS LOSS"
            textSize = 17f
            setTextColor(Color.WHITE)
            setPadding(0, px(18), 0, px(18))
            isEnabled = false
            setOnCheckedChangeListener { _, checked ->
                startService(Intent(this@MainActivity, TrackingService::class.java).apply {
                    action = TrackingService.ACTION_SET_SIMULATION
                    putExtra(TrackingService.EXTRA_SIMULATION, checked)
                })
            }
        }
        root.addView(simulationSwitch, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        shareChatGptButton = Button(this).apply {
            text = "НАДІСЛАТИ В CHATGPT"
            isEnabled = false
            setOnClickListener { shareLatestTrip(preferChatGpt = true) }
        }
        root.addView(shareChatGptButton, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        shareCsvButton = Button(this).apply {
            text = "ПОДІЛИТИСЯ CSV"
            isEnabled = false
            setOnClickListener { shareLatestTrip(preferChatGpt = false) }
        }
        root.addView(shareCsvButton, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        root.addView(TextView(this).apply {
            text = "Після STOP кнопка надішле останній завершений лог. Під час запису поширення блокується."
            textSize = 13f
            setTextColor(Color.LTGRAY)
            setPadding(0, px(6), 0, px(18))
        })

        statusText = TextView(this).apply {
            text = "Ready. Grant location permission and start recording."
            textSize = 16f
            setTextColor(Color.WHITE)
            setLineSpacing(0f, 1.25f)
            gravity = Gravity.START
        }
        root.addView(statusText, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        return ScrollView(this).apply { addView(root) }
    }

    private fun startTracking() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestRequiredPermissions()
            return
        }
        currentTripPath = null
        recording = true
        refreshShareButtons()
        val intent = Intent(this, TrackingService::class.java).apply { action = TrackingService.ACTION_START }
        startForegroundService(intent)
    }

    private fun requestRequiredPermissions() {
        val missing = mutableListOf<String>()
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            missing += Manifest.permission.ACCESS_FINE_LOCATION
        }
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            missing += Manifest.permission.POST_NOTIFICATIONS
        }
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), 100)
    }

    private fun renderTelemetry(intent: Intent) {
        val running = intent.getBooleanExtra(TrackingService.EXTRA_RUNNING, false)
        recording = running
        val simulation = intent.getBooleanExtra(TrackingService.EXTRA_SIMULATION, false)
        val trust = intent.getIntExtra(TrackingService.EXTRA_TRUST, 0)
        val visible = intent.getIntExtra(TrackingService.EXTRA_SAT_VISIBLE, 0)
        val used = intent.getIntExtra(TrackingService.EXTRA_SAT_USED, 0)
        val rawSupported = intent.getBooleanExtra(TrackingService.EXTRA_RAW_SUPPORTED, false)
        val rawCount = intent.getIntExtra(TrackingService.EXTRA_RAW_COUNT, 0)
        val impossibleJump = intent.getBooleanExtra(TrackingService.EXTRA_IMPOSSIBLE_JUMP, false)
        val accel = intent.getBooleanExtra(TrackingService.EXTRA_ACCEL, false)
        val gyro = intent.getBooleanExtra(TrackingService.EXTRA_GYRO, false)
        val rotation = intent.getBooleanExtra(TrackingService.EXTRA_ROTATION, false)
        val gameRotation = intent.getBooleanExtra(TrackingService.EXTRA_GAME_ROTATION, false)
        val path = intent.getStringExtra(TrackingService.EXTRA_FILE)
        if (!path.isNullOrBlank()) currentTripPath = path

        val lat = if (intent.hasExtra(TrackingService.EXTRA_LAT)) intent.getDoubleExtra(TrackingService.EXTRA_LAT, 0.0) else null
        val lon = if (intent.hasExtra(TrackingService.EXTRA_LON)) intent.getDoubleExtra(TrackingService.EXTRA_LON, 0.0) else null
        val accuracy = if (intent.hasExtra(TrackingService.EXTRA_ACCURACY)) intent.getFloatExtra(TrackingService.EXTRA_ACCURACY, 0f) else null
        val speed = if (intent.hasExtra(TrackingService.EXTRA_SPEED)) intent.getFloatExtra(TrackingService.EXTRA_SPEED, 0f) else null
        val bearing = if (intent.hasExtra(TrackingService.EXTRA_BEARING)) intent.getFloatExtra(TrackingService.EXTRA_BEARING, 0f) else null
        val cn0 = if (intent.hasExtra(TrackingService.EXTRA_CN0)) intent.getFloatExtra(TrackingService.EXTRA_CN0, 0f) else null

        if (simulationSwitch.isChecked != simulation) {
            simulationSwitch.setOnCheckedChangeListener(null)
            simulationSwitch.isChecked = simulation
            simulationSwitch.setOnCheckedChangeListener { _, checked ->
                startService(Intent(this, TrackingService::class.java).apply {
                    action = TrackingService.ACTION_SET_SIMULATION
                    putExtra(TrackingService.EXTRA_SIMULATION, checked)
                })
            }
        }

        startButton.isEnabled = !running
        stopButton.isEnabled = running
        simulationSwitch.isEnabled = running
        refreshShareButtons()

        val mode = if (simulation) "SIMULATED GNSS LOSS" else "LIVE GNSS"
        val speedKmh = speed?.times(3.6f)
        statusText.text = buildString {
            appendLine("Mode: $mode")
            appendLine("Recording: ${if (running) "YES" else "NO"}")
            appendLine("GNSS trust: $trust / 100")
            appendLine("Impossible jump: ${if (impossibleJump) "YES ⚠" else "no"}")
            appendLine()
            appendLine("Position: ${format(lat)}, ${format(lon)}")
            appendLine("Accuracy: ${accuracy?.let { "%.1f m".format(it) } ?: "—"}")
            appendLine("Speed: ${speedKmh?.let { "%.1f km/h".format(it) } ?: "—"}")
            appendLine("Bearing: ${bearing?.let { "%.1f°".format(it) } ?: "—"}")
            appendLine()
            appendLine("Satellites: $used used / $visible visible")
            appendLine("Mean C/N0: ${cn0?.let { "%.1f dB-Hz".format(it) } ?: "—"}")
            appendLine("Raw GNSS: ${if (rawSupported) "YES ($rawCount measurements)" else "not ready / unsupported"}")
            appendLine()
            appendLine("Accelerometer: ${yesNo(accel)}")
            appendLine("Gyroscope: ${yesNo(gyro)}")
            appendLine("Rotation vector: ${yesNo(rotation)}")
            appendLine("Game rotation vector: ${yesNo(gameRotation)}")
            appendLine()
            appendLine("Trip CSV:")
            append(path ?: currentTripPath ?: "—")
        }
    }

    private fun refreshShareButtons() {
        val file = latestCompletedTripFile()
        val enabled = !recording && file != null && file.isFile && file.length() > 0L
        if (::shareChatGptButton.isInitialized) shareChatGptButton.isEnabled = enabled
        if (::shareCsvButton.isInitialized) shareCsvButton.isEnabled = enabled
    }

    private fun latestCompletedTripFile(): File? {
        val explicit = currentTripPath?.let(::File)?.takeIf { it.isFile }
        if (explicit != null) return explicit

        val tripsDir = File(getExternalFilesDir(null) ?: filesDir, "trips")
        return tripsDir.listFiles { file ->
            file.isFile && file.extension.equals("csv", ignoreCase = true)
        }?.maxByOrNull { it.lastModified() }
    }

    private fun shareLatestTrip(preferChatGpt: Boolean) {
        if (recording) {
            Toast.makeText(this, "Спочатку натисни STOP, щоб завершити CSV.", Toast.LENGTH_LONG).show()
            return
        }

        val file = latestCompletedTripFile()
        if (file == null || !file.isFile || file.length() == 0L) {
            Toast.makeText(this, "Завершений CSV ще не знайдено.", Toast.LENGTH_LONG).show()
            refreshShareButtons()
            return
        }

        val uri = TripFileProvider.uriFor(file)
        val shareIntent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(
                Intent.EXTRA_TEXT,
                "Проаналізуй цей лог AntiJam Nav Core. Перевір GNSS/IMU, момент simulated GNSS loss, якість сигналу та аномалії."
            )
            clipData = ClipData.newRawUri(file.name, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

        if (preferChatGpt) {
            val direct = Intent(shareIntent).setPackage(CHATGPT_PACKAGE)
            try {
                startActivity(direct)
                return
            } catch (_: ActivityNotFoundException) {
            } catch (_: SecurityException) {
            }
        }

        try {
            startActivity(Intent.createChooser(shareIntent, "Подеілитися логом AntiJam Nav"))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, "Немає застосунку, який може прийняти CSV.", Toast.LENGTH_LONG).show()
        }
    }

    private fun format(value: Double?): String = value?.let { "%.6f".format(it) } ?: "—"
    private fun yesNo(value: Boolean) = if (value) "YES" else "NO"
}
