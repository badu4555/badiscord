package com.badiscord.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import io.livekit.android.LiveKit
import io.livekit.android.room.Room
import io.livekit.android.audio.ScreenAudioCapturer
import io.livekit.android.room.track.screencapture.ScreenCaptureParams
import io.livekit.android.room.track.LocalAudioTrack
import io.livekit.android.room.track.LocalVideoTrack
import io.livekit.android.room.track.Track
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch

class ScreenShareService : Service() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var room: Room? = null
    private var shareJob: Job? = null
    private var screenAudioCapturer: ScreenAudioCapturer? = null
    private var screenAudioTrack: LocalAudioTrack? = null
    private var isStopping = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> stopSharing()
            ACTION_START -> startSharing(intent, startId)
            else -> stopSelf(startId)
        }
        return START_NOT_STICKY
    }

    private fun startSharing(intent: Intent, startId: Int) {
        if (room != null || shareJob?.isActive == true) return

        val serverUrl = intent.getStringExtra(EXTRA_SERVER_URL).orEmpty()
        val token = intent.getStringExtra(EXTRA_TOKEN).orEmpty()
        val identity = intent.getStringExtra(EXTRA_IDENTITY).orEmpty()
        val projectionData = getProjectionData(intent)
        if (serverUrl.isBlank() || token.isBlank() || !identity.endsWith("-mobile-screen") || projectionData == null) {
            publishState(false, "Não foi possível iniciar a transmissão: dados inválidos.")
            stopSelf(startId)
            return
        }

        createNotificationChannel()
        val notification = buildNotification()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                var serviceType = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    serviceType = serviceType or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                }
                startForeground(NOTIFICATION_ID, notification, serviceType)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (error: Exception) {
            publishState(false, error.message ?: "O Android não autorizou o serviço de transmissão.")
            stopSelf(startId)
            return
        }

        shareJob = serviceScope.launch {
            try {
                val liveKitRoom = LiveKit.create(applicationContext)
                room = liveKitRoom
                liveKitRoom.connect(serverUrl, token)
                val published = liveKitRoom.localParticipant.setScreenShareEnabled(
                    true,
                    ScreenCaptureParams(
                        mediaProjectionPermissionResultData = projectionData,
                        notificationId = NOTIFICATION_ID,
                        notification = notification,
                        onStop = { if (!isStopping) stopSharing() }
                    )
                )
                if (!published) throw IllegalStateException("O LiveKit não publicou a tela.")
                val audioWarning = startScreenAudioCapture(liveKitRoom)
                publishState(true, audioWarning)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                publishState(false, error.message ?: "Não foi possível conectar a transmissão ao servidor.")
                stopSelf(startId)
            }
        }
    }

    private suspend fun startScreenAudioCapture(liveKitRoom: Room): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return "A tela está sendo transmitida sem áudio do sistema. A captura de áudio exige Android 10 ou superior."
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            return "A tela está sendo transmitida sem áudio. Permita o acesso ao microfone para capturar o áudio do sistema."
        }

        return try {
            val screenTrack = liveKitRoom.localParticipant
                .getTrackPublication(Track.Source.SCREEN_SHARE)?.track as? LocalVideoTrack
                ?: return "A tela está sendo transmitida, mas não foi possível iniciar a captura de áudio."
            liveKitRoom.localParticipant.setMicrophoneEnabled(true)
            val audioTrack = liveKitRoom.localParticipant
                .getTrackPublication(Track.Source.MICROPHONE)?.track as? LocalAudioTrack
                ?: run {
                    liveKitRoom.localParticipant.setMicrophoneEnabled(false)
                    return "A tela está sendo transmitida, mas o LiveKit não criou a faixa de áudio."
                }
            val capturer = ScreenAudioCapturer.createFromScreenShareTrack(screenTrack)
            if (capturer == null) {
                liveKitRoom.localParticipant.setMicrophoneEnabled(false)
                return "A tela está sendo transmitida sem áudio. O Android não disponibilizou a captura do áudio do sistema."
            }
            screenAudioCapturer = capturer
            screenAudioTrack = audioTrack
            audioTrack.setAudioBufferCallback(capturer)
            ""
        } catch (error: Exception) {
            releaseScreenAudioCapture()
            try {
                liveKitRoom.localParticipant.setMicrophoneEnabled(false)
            } catch (disableError: Exception) {
                android.util.Log.w(TAG, "Não foi possível desativar a faixa de áudio após falha.", disableError)
            }
            android.util.Log.w(TAG, "Não foi possível iniciar o áudio da transmissão.", error)
            "A tela está sendo transmitida sem áudio do sistema: ${error.message ?: "captura indisponível"}."
        }
    }

    private fun releaseScreenAudioCapture() {
        screenAudioTrack?.setAudioBufferCallback(null)
        screenAudioTrack = null
        screenAudioCapturer?.releaseAudioResources()
        screenAudioCapturer = null
    }

    private fun stopSharing() {
        if (isStopping) return
        isStopping = true
        serviceScope.launch {
            shareJob?.cancelAndJoin()
            shareJob = null
            try {
                releaseScreenAudioCapture()
            } catch (error: Exception) {
                android.util.Log.w(TAG, "Não foi possível liberar a captura de áudio.", error)
            }
            try {
                room?.localParticipant?.setMicrophoneEnabled(false)
            } catch (error: Exception) {
                android.util.Log.w(TAG, "A faixa de áudio pode já estar desconectada.", error)
            }
            try {
                room?.localParticipant?.setScreenShareEnabled(false)
            } catch (error: Exception) {
                android.util.Log.w(TAG, "A tela pode já estar desconectada.", error)
            }
            try {
                room?.disconnect()
            } catch (error: Exception) {
                android.util.Log.w(TAG, "A sala LiveKit pode já estar desconectada.", error)
            } finally {
                room = null
                publishState(false)
                stopSelf()
                isStopping = false
            }
        }
    }

    private fun buildNotification(): Notification {
        val stopIntent = PendingIntent.getService(
            this,
            0,
            Intent(this, ScreenShareService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.screen_share_notification))
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .addAction(android.R.drawable.ic_media_pause, getString(R.string.stop_screen_share), stopIntent)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.screen_share_notification),
                NotificationManager.IMPORTANCE_LOW
            )
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun publishState(active: Boolean, message: String = "") {
        sendBroadcast(
            Intent(ACTION_STATE)
                .setPackage(packageName)
                .putExtra(EXTRA_ACTIVE, active)
                .putExtra(EXTRA_MESSAGE, message)
        )
    }

    @Suppress("DEPRECATION")
    private fun getProjectionData(intent: Intent): Intent? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(EXTRA_PROJECTION_DATA, Intent::class.java)
        } else {
            intent.getParcelableExtra(EXTRA_PROJECTION_DATA)
        }

    override fun onDestroy() {
        releaseScreenAudioCapture()
        serviceScope.cancel()
        room?.disconnect()
        super.onDestroy()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        stopSharing()
        super.onTaskRemoved(rootIntent)
    }

    companion object {
        const val ACTION_START = "com.badiscord.mobile.START_SCREEN_SHARE"
        const val ACTION_STOP = "com.badiscord.mobile.STOP_SCREEN_SHARE"
        const val ACTION_STATE = "com.badiscord.mobile.SCREEN_SHARE_STATE"
        const val EXTRA_SERVER_URL = "serverUrl"
        const val EXTRA_TOKEN = "token"
        const val EXTRA_IDENTITY = "identity"
        const val EXTRA_PROJECTION_DATA = "projectionData"
        const val EXTRA_ACTIVE = "active"
        const val EXTRA_MESSAGE = "message"

        private const val CHANNEL_ID = "badiscord_screen_share"
        private const val NOTIFICATION_ID = 4055
        private const val TAG = "ScreenShareService"
    }
}
