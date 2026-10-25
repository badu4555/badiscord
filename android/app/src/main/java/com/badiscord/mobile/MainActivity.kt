package com.badiscord.mobile

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private var pendingShare: ShareRequest? = null
    private var pendingWebPermission: PermissionRequest? = null

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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom)
            insets
        }
        setContentView(webView)
        configureWebView()
        registerShareStateReceiver()
        webView.loadUrl(TRUSTED_URL)
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
                if (!isTrustedUrl(Uri.parse(url)) || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
                view.evaluateJavascript(NATIVE_BRIDGE_SCRIPT, null)
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
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
