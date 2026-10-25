package com.badiscord.mobile

import android.Manifest
import android.app.AlertDialog
import android.app.Activity
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.widget.Toast
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var rootContainer: FrameLayout
    private lateinit var fullscreenBackCallback: OnBackPressedCallback
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var pendingShare: ShareRequest? = null
    private var pendingWebPermission: PermissionRequest? = null
    private var pendingInstallerUri: Uri? = null
    private var updateCheckStarted = false
    private var requestingInstallPermission = false

    private val installPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) {
        requestingInstallPermission = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && packageManager.canRequestPackageInstalls()) {
            launchPendingInstaller()
        } else {
            pendingInstallerUri = null
            clearPendingDownload()
            Toast.makeText(this, "Autorize a instalação do BADISCORD nas configurações do Android.", Toast.LENGTH_LONG).show()
        }
    }

    private val screenCaptureLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val request = pendingShare
        pendingShare = null
        if (request == null) return@registerForActivityResult
        if (result.resultCode != Activity.RESULT_OK || result.data == null) {
            reportShareState(false, "O compartilhamento de tela foi cancelado.")
            return@registerForActivityResult
        }

        val serviceIntent = Intent(this, ScreenShareService::class.java).apply {
            action = ScreenShareService.ACTION_START
            putExtra(ScreenShareService.EXTRA_SERVER_URL, request.serverUrl)
            putExtra(ScreenShareService.EXTRA_TOKEN, request.token)
            putExtra(ScreenShareService.EXTRA_IDENTITY, request.identity)
            putExtra(ScreenShareService.EXTRA_PROJECTION_DATA, result.data)
        }
        try {
            if (startService(serviceIntent) == null) {
                reportShareState(false, "O Android não conseguiu iniciar o serviço de transmissão.")
            }
        } catch (error: IllegalStateException) {
            reportShareState(false, error.message ?: "O Android bloqueou o serviço de transmissão.")
        } catch (error: SecurityException) {
            reportShareState(false, error.message ?: "O Android não autorizou o serviço de transmissão.")
        }
    }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) {
        if (pendingShare != null) launchScreenCapturePermission()
    }

    private val webPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        val request = pendingWebPermission
        pendingWebPermission = null
        if (request == null) return@registerForActivityResult

        val allowedResources = allowedWebResources(request, results).toTypedArray()

        if (allowedResources.isEmpty()) request.deny() else request.grant(allowedResources)
    }

    private val shareStateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != ScreenShareService.ACTION_STATE) return
            reportShareState(
                intent.getBooleanExtra(ScreenShareService.EXTRA_ACTIVE, false),
                intent.getStringExtra(ScreenShareService.EXTRA_MESSAGE).orEmpty()
            )
        }
    }

    private val updateDownloadReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
            val downloadId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
            val preferences = getSharedPreferences(UPDATE_PREFERENCES, Context.MODE_PRIVATE)
            if (downloadId < 0 || downloadId != preferences.getLong(KEY_DOWNLOAD_ID, -1L)) return

            val manager = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
            manager.query(DownloadManager.Query().setFilterById(downloadId)).use { cursor ->
                if (!cursor.moveToFirst()) {
                    clearPendingDownload()
                    Toast.makeText(this@MainActivity, "Não foi possível localizar a atualização baixada.", Toast.LENGTH_LONG).show()
                    return
                }
                when (cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))) {
                    DownloadManager.STATUS_SUCCESSFUL -> {
                        preferences.edit().putBoolean(KEY_INSTALL_PENDING, true).apply()
                        if (hasWindowFocus()) installDownloadedUpdate(downloadId)
                    }
                    DownloadManager.STATUS_FAILED -> {
                        val reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
                        clearPendingDownload()
                        Toast.makeText(this@MainActivity, "Falha ao baixar a atualização (código $reason).", Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        rootContainer = FrameLayout(this).apply {
            addView(
                webView,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            )
        }
        ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom)
            insets
        }
        setContentView(rootContainer)
        fullscreenBackCallback = object : OnBackPressedCallback(false) {
            override fun handleOnBackPressed() {
                hideCustomView()
            }
        }
        onBackPressedDispatcher.addCallback(this, fullscreenBackCallback)
        configureWebView()
        registerShareStateReceiver()
        registerUpdateDownloadReceiver()
        webView.loadUrl(TRUSTED_URL)
    }

    override fun onResume() {
        super.onResume()
        if (requestingInstallPermission) return
        val preferences = getSharedPreferences(UPDATE_PREFERENCES, Context.MODE_PRIVATE)
        val downloadId = preferences.getLong(KEY_DOWNLOAD_ID, -1L)
        if (downloadId >= 0L && preferences.getBoolean(KEY_INSTALL_PENDING, false)) {
            installDownloadedUpdate(downloadId)
        }
    }

    private fun configureWebView() {
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.mediaPlaybackRequiresUserGesture = false
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = false

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(
                webView,
                "BADISCORDNative",
                setOf(TRUSTED_ORIGIN)
            ) { _, message, sourceOrigin, isMainFrame, _ ->
                if (!isMainFrame || sourceOrigin.toString() != TRUSTED_ORIGIN) return@addWebMessageListener
                handleNativeMessage(message.data)
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return !isTrustedUrl(request.url)
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (!isTrustedUrl(Uri.parse(url))) return
                if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                    view.evaluateJavascript(NATIVE_BRIDGE_SCRIPT, null)
                }
                checkForAppUpdate()
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (customView != null) {
                    callback.onCustomViewHidden()
                    return
                }

                customView = view
                customViewCallback = callback
                rootContainer.addView(
                    view,
                    FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                )
                fullscreenBackCallback.isEnabled = true
                WindowInsetsControllerCompat(window, rootContainer).apply {
                    systemBarsBehavior =
                        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    hide(WindowInsetsCompat.Type.systemBars())
                }
            }

            override fun onHideCustomView() {
                this@MainActivity.hideCustomView()
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                if (!isTrustedUrl(Uri.parse(request.origin.toString()))) {
                    request.deny()
                    return
                }

                val neededPermissions = buildList {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE in request.resources &&
                        !hasPermission(Manifest.permission.RECORD_AUDIO)
                    ) add(Manifest.permission.RECORD_AUDIO)
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE in request.resources &&
                        !hasPermission(Manifest.permission.CAMERA)
                    ) add(Manifest.permission.CAMERA)
                }
                val allowedResources = allowedWebResources(request, emptyMap())
                if (neededPermissions.isEmpty()) {
                    if (allowedResources.isEmpty()) request.deny() else request.grant(allowedResources.toTypedArray())
                } else if (pendingWebPermission == null) {
                    pendingWebPermission = request
                    webPermissionLauncher.launch(neededPermissions.toTypedArray())
                } else {
                    request.deny()
                }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (pendingWebPermission === request) pendingWebPermission = null
            }
        }
    }

    private fun hideCustomView() {
        val view = customView ?: return
        rootContainer.removeView(view)
        customView = null
        fullscreenBackCallback.isEnabled = false
        val callback = customViewCallback
        customViewCallback = null
        callback?.onCustomViewHidden()
        WindowInsetsControllerCompat(window, rootContainer).show(
            WindowInsetsCompat.Type.systemBars()
        )
    }

    private fun handleNativeMessage(rawMessage: String) {
        runOnUiThread { processNativeMessage(rawMessage) }
    }

    private fun processNativeMessage(rawMessage: String) {
        val message = runCatching { JSONObject(rawMessage) }.getOrNull() ?: return
        when (message.optString("action")) {
            "start" -> {
                val request = ShareRequest(
                    serverUrl = message.optString("serverUrl"),
                    token = message.optString("token"),
                    identity = message.optString("identity")
                )
                if (!request.isValid()) {
                    reportShareState(false, "Não foi possível validar as credenciais da transmissão.")
                    return
                }
                pendingShare = request
                if (
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                    !hasPermission(Manifest.permission.POST_NOTIFICATIONS)
                ) {
                    notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                } else {
                    launchScreenCapturePermission()
                }
            }
            "stop" -> {
                pendingShare = null
                startService(Intent(this, ScreenShareService::class.java).setAction(ScreenShareService.ACTION_STOP))
            }
        }
    }

    private fun isTrustedUrl(uri: Uri): Boolean =
        uri.scheme == "https" && uri.host == TRUSTED_HOST && (uri.port == -1 || uri.port == 443)

    private fun launchScreenCapturePermission() {
        if (pendingShare == null) return
        val projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        screenCaptureLauncher.launch(projectionManager.createScreenCaptureIntent())
    }

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun allowedWebResources(
        request: PermissionRequest,
        results: Map<String, Boolean>
    ): List<String> = request.resources.filter { resource ->
        when (resource) {
            PermissionRequest.RESOURCE_AUDIO_CAPTURE ->
                results[Manifest.permission.RECORD_AUDIO] == true || hasPermission(Manifest.permission.RECORD_AUDIO)
            PermissionRequest.RESOURCE_VIDEO_CAPTURE ->
                results[Manifest.permission.CAMERA] == true || hasPermission(Manifest.permission.CAMERA)
            else -> false
        }
    }

    private fun registerShareStateReceiver() {
        val filter = IntentFilter(ScreenShareService.ACTION_STATE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(shareStateReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(shareStateReceiver, filter)
        }
    }

    private fun registerUpdateDownloadReceiver() {
        val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(updateDownloadReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(updateDownloadReceiver, filter)
        }
    }

    private fun checkForAppUpdate() {
        if (updateCheckStarted) return
        updateCheckStarted = true

        val preferences = getSharedPreferences(UPDATE_PREFERENCES, Context.MODE_PRIVATE)
        val existingDownloadId = preferences.getLong(KEY_DOWNLOAD_ID, -1L)
        if (existingDownloadId >= 0L) {
            val manager = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
            manager.query(DownloadManager.Query().setFilterById(existingDownloadId)).use { cursor ->
                if (cursor.moveToFirst()) {
                    when (cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))) {
                        DownloadManager.STATUS_PENDING,
                        DownloadManager.STATUS_RUNNING,
                        DownloadManager.STATUS_PAUSED -> return
                        DownloadManager.STATUS_SUCCESSFUL -> {
                            if (preferences.getBoolean(KEY_INSTALL_PENDING, false)) {
                                installDownloadedUpdate(existingDownloadId)
                            }
                            return
                        }
                    }
                }
            }
            clearPendingDownload()
        }

        Thread {
            val latest = try {
                val connection = URL(LATEST_RELEASE_API).openConnection() as HttpURLConnection
                try {
                    connection.connectTimeout = UPDATE_TIMEOUT_MS
                    connection.readTimeout = UPDATE_TIMEOUT_MS
                    connection.setRequestProperty("Accept", "application/vnd.github+json")
                    connection.setRequestProperty("User-Agent", "BADISCORD-Android")
                    connection.connect()
                    if (connection.responseCode !in 200..299) {
                        throw IllegalStateException("GitHub retornou HTTP ${connection.responseCode}.")
                    }
                    connection.inputStream.bufferedReader().use { JSONObject(it.readText()) }
                        .takeIf { !it.optBoolean("draft") && !it.optBoolean("prerelease") }
                } finally {
                    connection.disconnect()
                }
            } catch (error: Exception) {
                android.util.Log.w(TAG, "Não foi possível verificar atualizações do BADISCORD.", error)
                null
            }

            val tag = latest?.optString("tag_name").orEmpty()
            val version = tag.removePrefix("v")
            val installedVersion = packageManager.getPackageInfo(packageName, 0).versionName.orEmpty()
            val apkAsset = latest?.optJSONArray("assets")
                ?.let { assets -> (0 until assets.length()).map { assets.optJSONObject(it) } }
                ?.firstOrNull { it?.optString("name") == ANDROID_APK_NAME }
            val downloadUrl = apkAsset?.optString("browser_download_url").orEmpty()
            if (!isValidReleaseTag(tag) || compareVersions(version, installedVersion) <= 0 ||
                !isTrustedReleaseDownload(downloadUrl)
            ) return@Thread

            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                AlertDialog.Builder(this)
                    .setTitle("Atualização $version disponível")
                    .setMessage("O BADISCORD pode baixar a atualização agora. O Android pedirá sua confirmação para instalar.")
                    .setNegativeButton("Depois", null)
                    .setPositiveButton("Baixar atualização") { _, _ -> enqueueUpdateDownload(downloadUrl, version) }
                    .show()
            }
        }.start()
    }

    private fun enqueueUpdateDownload(downloadUrl: String, version: String) {
        try {
            val request = DownloadManager.Request(Uri.parse(downloadUrl))
                .setTitle("BADISCORD $version")
                .setDescription("Baixando atualização")
                .setMimeType(APK_MIME_TYPE)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(false)
                .setDestinationInExternalFilesDir(
                    this,
                    Environment.DIRECTORY_DOWNLOADS,
                    "BADISCORD-$version.apk"
                )
            val downloadId = (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
            getSharedPreferences(UPDATE_PREFERENCES, Context.MODE_PRIVATE).edit()
                .putLong(KEY_DOWNLOAD_ID, downloadId)
                .putBoolean(KEY_INSTALL_PENDING, false)
                .apply()
            Toast.makeText(this, "O download continuará em segundo plano. Você será avisado quando terminar.", Toast.LENGTH_LONG).show()
        } catch (error: Exception) {
            android.util.Log.e(TAG, "Não foi possível iniciar o download da atualização.", error)
            Toast.makeText(this, "Não foi possível iniciar o download da atualização.", Toast.LENGTH_LONG).show()
        }
    }

    private fun installDownloadedUpdate(downloadId: Long) {
        val uri = (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).getUriForDownloadedFile(downloadId)
        if (uri == null) {
            clearPendingDownload()
            Toast.makeText(this, "O APK baixado não está disponível para instalação.", Toast.LENGTH_LONG).show()
            return
        }
        pendingInstallerUri = uri
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
            requestingInstallPermission = true
            installPermissionLauncher.launch(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName"))
            )
            return
        }
        launchPendingInstaller()
    }

    private fun launchPendingInstaller() {
        val uri = pendingInstallerUri ?: return
        try {
            val installIntent = Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
                setDataAndType(uri, APK_MIME_TYPE)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                putExtra(Intent.EXTRA_RETURN_RESULT, true)
            }
            startActivity(installIntent)
            pendingInstallerUri = null
            clearPendingDownload()
        } catch (error: Exception) {
            android.util.Log.e(TAG, "Não foi possível abrir o instalador do Android.", error)
            pendingInstallerUri = null
            clearPendingDownload()
            Toast.makeText(this, "O Android não conseguiu abrir o instalador.", Toast.LENGTH_LONG).show()
        }
    }

    private fun clearPendingDownload() {
        getSharedPreferences(UPDATE_PREFERENCES, Context.MODE_PRIVATE).edit()
            .remove(KEY_DOWNLOAD_ID)
            .remove(KEY_INSTALL_PENDING)
            .apply()
    }

    private fun isValidReleaseTag(tag: String): Boolean =
        RELEASE_TAG_REGEX.matches(tag)

    private fun isTrustedReleaseDownload(downloadUrl: String): Boolean =
        runCatching {
            val uri = Uri.parse(downloadUrl)
            val segments = uri.pathSegments
            uri.scheme == "https" && uri.host == RELEASE_HOST && uri.userInfo == null &&
                uri.query == null && uri.fragment == null && segments.size == 6 &&
                segments[0] == "badu4555" && segments[1] == "badiscord" &&
                segments[2] == "releases" && segments[3] == "download" &&
                isValidReleaseTag(segments[4]) && segments[5] == ANDROID_APK_NAME
        }.getOrDefault(false)

    private fun compareVersions(left: String, right: String): Int {
        val leftParts = left.split('.').mapNotNull { it.toIntOrNull() }
        val rightParts = right.split('.').mapNotNull { it.toIntOrNull() }
        for (index in 0 until maxOf(leftParts.size, rightParts.size)) {
            val comparison = (leftParts.getOrElse(index) { 0 }).compareTo(rightParts.getOrElse(index) { 0 })
            if (comparison != 0) return comparison
        }
        return 0
    }

    private fun reportShareState(active: Boolean, message: String) {
        val quotedMessage = JSONObject.quote(message)
        runOnUiThread {
            if (::webView.isInitialized) {
                webView.evaluateJavascript(
                    "window.onAndroidScreenShareStateChanged?.($active, $quotedMessage)",
                    null
                )
            }
        }
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.destroy()
        }
        if (!isChangingConfigurations) {
            stopService(Intent(this, ScreenShareService::class.java))
        }
        unregisterReceiver(shareStateReceiver)
        unregisterReceiver(updateDownloadReceiver)
        super.onDestroy()
    }

    private data class ShareRequest(
        val serverUrl: String,
        val token: String,
        val identity: String
    ) {
        fun isValid(): Boolean {
            val uri = Uri.parse(serverUrl)
            return uri.scheme == "wss" &&
                !uri.host.isNullOrBlank() &&
                uri.userInfo == null &&
                uri.fragment == null &&
                token.length in 100..20_000 &&
                identity.endsWith("-mobile-screen") &&
                identity.length <= 160
        }
    }

    companion object {
        private const val TRUSTED_HOST = "badiscord.onrender.com"
        private const val TRUSTED_ORIGIN = "https://$TRUSTED_HOST"
        private const val TRUSTED_URL = "$TRUSTED_ORIGIN"
        private const val RELEASE_HOST = "github.com"
        private const val LATEST_RELEASE_API = "https://api.github.com/repos/badu4555/badiscord/releases/latest"
        private const val ANDROID_APK_NAME = "BADISCORD-Android.apk"
        private const val APK_MIME_TYPE = "application/vnd.android.package-archive"
        private const val UPDATE_PREFERENCES = "app_update"
        private const val KEY_DOWNLOAD_ID = "download_id"
        private const val KEY_INSTALL_PENDING = "install_pending"
        private const val UPDATE_TIMEOUT_MS = 10_000
        private val RELEASE_TAG_REGEX = Regex("""v\d+\.\d+\.\d+""")
        private const val TAG = "BADISCORD"

        private val NATIVE_BRIDGE_SCRIPT = """
            (() => {
              if (window.__badiscordNativeBridgeInstalled) return;
              window.__badiscordNativeBridgeInstalled = true;
              window.AndroidScreenShare = {
                startScreenShare(serverUrl, token, identity, participantName) {
                  window.BADISCORDNative?.postMessage(JSON.stringify({
                    action: 'start', serverUrl, token, identity, participantName
                  }));
                  return Boolean(window.BADISCORDNative);
                },
                stopScreenShare() {
                  window.BADISCORDNative?.postMessage(JSON.stringify({ action: 'stop' }));
                }
              };
              window.addEventListener('pagehide', () => window.AndroidScreenShare.stopScreenShare(), { once: true });
            })();
        """.trimIndent()
    }
}
