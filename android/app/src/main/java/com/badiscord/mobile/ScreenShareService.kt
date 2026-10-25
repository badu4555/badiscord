package com.badiscord.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import io.livekit.android.LiveKit
import io.livekit.android.room.Room
import io.livekit.android.room.track.screencapture.ScreenCaptureParams
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
                publishState(true)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                publishState(false, error.message ?: "Não foi possível conectar a transmissão ao servidor.")
                stopSelf(startId)
            }
        }
    }

    private fun stopSharing() {
        if (isStopping) return
        isStopping = true
        serviceScope.launch {
            shareJob?.cancelAndJoin()
            shareJob = null
            try {
                room?.localParticipant?.setScreenShareEnabled(false)
                room?.disconnect()
            } catch (error: Exception) {
                android.util.Log.w(TAG, "A transmissão pode já estar desconectada.", error)
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
