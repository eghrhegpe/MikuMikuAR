package com.wails.app;

import android.util.Log;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.wails.app.BuildConfig;

/**
 * WailsJSBridge provides the JavaScript interface that allows the web frontend
 * to communicate with the Go backend. This is exposed to JavaScript as the
 * `window.wails` object.
 *
 * Similar to iOS's WKScriptMessageHandler but using Android's addJavascriptInterface.
 */
public class WailsJSBridge {
    private static final String TAG = "WailsJSBridge";
    private static final boolean DEBUG = BuildConfig.DEBUG;
    // Pooled threads avoid unbounded thread creation under high call volume.
    private static final ExecutorService executor = Executors.newCachedThreadPool();

    private final WailsBridge bridge;
    private final WebView webView;

    public WailsJSBridge(WailsBridge bridge, WebView webView) {
        this.bridge = bridge;
        this.webView = webView;
    }

    /**
     * Send a message to Go and return the response synchronously.
     * Called from JavaScript: wails.invoke(message)
     *
     * @param message The message to send (JSON string)
     * @return The response from Go (JSON string)
     */
    @JavascriptInterface
    public String invoke(String message) {
        if (DEBUG) Log.d(TAG, "Invoke called: " + message);
        return bridge.handleMessage(message);
    }

    /**
     * Send a message to Go asynchronously.
     * The response will be sent back via a callback.
     * Called from JavaScript: wails.invokeAsync(callbackId, message)
     *
     * @param callbackId The callback ID to use for the response
     * @param message The message to send (JSON string)
     */
    @JavascriptInterface
    public void invokeAsync(final String callbackId, final String payload) {
        if (DEBUG) Log.d(TAG, "InvokeAsync called: " + payload);

        // Handle off the JS thread so we don't block the WebView.
        executor.execute(() -> {
            try {
                String response = bridge.handleRuntimeCall(payload);
                sendCallback(callbackId, response, null);
            } catch (Exception e) {
                Log.e(TAG, "Error in async invoke", e);
                sendCallback(callbackId, null, e.getMessage());
            }
        });
    }

    /**
     * Log a message from JavaScript to Android's logcat
     * Called from JavaScript: wails.log(level, message)
     *
     * @param level The log level (debug, info, warn, error)
     * @param message The message to log
     */
    @JavascriptInterface
    public void log(String level, String message) {
        switch (level.toLowerCase()) {
            case "debug":
                Log.d(TAG + "/JS", message);
                break;
            case "info":
                Log.i(TAG + "/JS", message);
                break;
            case "warn":
                Log.w(TAG + "/JS", message);
                break;
            case "error":
                Log.e(TAG + "/JS", message);
                break;
            default:
                Log.v(TAG + "/JS", message);
                break;
        }
    }

    /**
     * Get the platform name
     * Called from JavaScript: wails.platform()
     *
     * @return "android"
     */
    @JavascriptInterface
    public String platform() {
        return "android";
    }

    /**
     * Check if we're running in debug mode
     * Called from JavaScript: wails.isDebug()
     *
     * @return true if debug build, false otherwise
     */
    @JavascriptInterface
    public boolean isDebug() {
        return BuildConfig.DEBUG;
    }

    /**
     * Request MANAGE_EXTERNAL_STORAGE permission (Android 11+).
     * Shows a dialog guiding the user to the "All files access" settings page.
     * When the grant is detected (via onResume or onActivityResult), a
     * "storage:permissionGranted" system event is emitted to JS.
     *
     * Called from JavaScript: wails.requestStoragePermission()
     */
    @JavascriptInterface
    public void requestStoragePermission() {
        android.app.Activity activity = bridge.getActivity();
        if (activity instanceof MainActivity) {
            ((MainActivity) activity).requestStoragePermission();
        } else {
            Log.w(TAG, "requestStoragePermission: activity is not MainActivity");
        }
    }

    /**
     * Check whether MANAGE_EXTERNAL_STORAGE (Android 11+) or legacy
     * READ/WRITE_EXTERNAL_STORAGE (Android 10-) is currently granted.
     *
     * Called from JavaScript: wails.hasStoragePermission()
     *
     * @return true if the app can read /sdcard/MMD
     */
    @JavascriptInterface
    public boolean hasStoragePermission() {
        android.app.Activity activity = bridge.getActivity();
        if (activity instanceof MainActivity) {
            return ((MainActivity) activity).hasManageStoragePermission();
        }
        return false;
    }

    /**
     * Check whether the Android CAMERA runtime permission is currently granted.
     * The web frontend needs this before navigator.mediaDevices.getUserMedia
     * can open the camera for AR mode.
     *
     * Called from JavaScript: wails.hasCameraPermission()
     *
     * @return true if the app may open the camera for AR mode
     */
    @JavascriptInterface
    public boolean hasCameraPermission() {
        android.app.Activity activity = bridge.getActivity();
        if (activity instanceof MainActivity) {
            return ((MainActivity) activity).hasCameraPermission();
        }
        return false;
    }

    /**
     * Request the Android CAMERA runtime permission for AR mode. The result is
     * delivered to JS via window.__onArcCameraPermission(granted).
     * Called from JavaScript: wails.requestCameraPermission()
     */
    @JavascriptInterface
    public void requestCameraPermission() {
        android.app.Activity activity = bridge.getActivity();
        if (activity instanceof MainActivity) {
            ((MainActivity) activity).requestCameraPermission();
        } else {
            Log.w(TAG, "requestCameraPermission: activity is not MainActivity");
        }
    }

    /**
     * Request the application to exit (finish the root Activity).
     * Invoked by the web frontend's double-back-to-exit flow (ADR-017 A2-02):
     * when the user presses back twice with no overlay open, JS calls this to
     * actually terminate the app instead of being trapped inside it.
     *
     * Called from JavaScript: wails.exitApp()
     */
    @JavascriptInterface
    public void exitApp() {
        android.app.Activity activity = bridge.getActivity();
        if (activity != null) {
            // @JavascriptInterface runs on the WebView bridge thread; finish()
            // must be posted to the UI thread.
            activity.runOnUiThread(activity::finish);
        } else {
            Log.w(TAG, "exitApp: no activity available");
        }
    }

    /**
     * Probe WebXR support in the current WebView (ADR-072 P1).
     * Evaluates navigator.xr availability and reports the result back to JS
     * via window.__onWebXRProbeResult(json).
     *
     * The probe checks:
     * - WebView package name and version (identifies Chrome vs System WebView)
     * - navigator.xr existence
     * - Whether the WebView was launched with WebXR flags (if accessible)
     *
     * Called from JavaScript: wails.probeWebXRSupport()
     */
    @JavascriptInterface
    public void probeWebXRSupport() {
        webView.post(() -> {
            // Gather WebView package info
            String webViewPackage = "unknown";
            String webViewVersion = "unknown";
            try {
                android.webkit.WebView currentWebView = webView;
                if (currentWebView != null) {
                    android.content.pm.PackageInfo pi = android.webkit.WebView.getCurrentWebViewPackage();
                    if (pi != null) {
                        webViewPackage = pi.packageName != null ? pi.packageName : "unknown";
                        webViewVersion = pi.versionName != null ? pi.versionName : "unknown";
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "probeWebXRSupport: failed to get WebView package info", e);
            }

            final String pkg = webViewPackage;
            final String ver = webViewVersion;

            // Evaluate navigator.xr in the WebView context
            String js = "(function() {" +
                "var result = {" +
                "  webViewPackage: '" + pkg.replace("'", "\\'") + "'," +
                "  webViewVersion: '" + ver.replace("'", "\\'") + "'," +
                "  xrExists: typeof navigator.xr !== 'undefined'," +
                "  xrIsSessionSupported: false," +
                "  userAgent: navigator.userAgent" +
                "};" +
                "if (result.xrExists && navigator.xr.isSessionSupported) {" +
                "  navigator.xr.isSessionSupported('immersive-ar').then(function(supported) {" +
                "    result.xrIsSessionSupported = supported;" +
                "    window.__onWebXRProbeResult && window.__onWebXRProbeResult(JSON.stringify(result));" +
                "  }).catch(function(e) {" +
                "    result.error = e.message || String(e);" +
                "    window.__onWebXRProbeResult && window.__onWebXRProbeResult(JSON.stringify(result));" +
                "  });" +
                "} else {" +
                "  window.__onWebXRProbeResult && window.__onWebXRProbeResult(JSON.stringify(result));" +
                "}" +
                "return 'probe_started';" +
                "})()";

            webView.evaluateJavascript(js, null);
        });
    }

    /**
     * Launch the ARCore × WebView coexistence probe activity (ADR-073 P1).
     * This opens a separate Activity that:
     * 1. Creates an ARCore session and renders camera frames to a GLSurfaceView
     * 2. Overlays a transparent WebView on top
     * 3. Reports whether the coexistence works (no EGL conflict)
     *
     * The result is delivered to JS via window.__onARCoreProbeResult(json).
     *
     * Called from JavaScript: wails.launchARCoreProbe()
     */
    @JavascriptInterface
    public void launchARCoreProbe() {
        android.app.Activity activity = bridge.getActivity();
        if (activity == null) {
            Log.w(TAG, "launchARCoreProbe: no activity available");
            return;
        }
        activity.runOnUiThread(() -> {
            android.content.Intent intent = new android.content.Intent(activity, ARCoreProbeActivity.class);
            activity.startActivityForResult(intent, 7020, null);
        });
    }

    /**
     * Send a callback response to JavaScript
     */
    private void sendCallback(String callbackId, String result, String error) {
        final String js;
        if (error != null) {
            js = String.format(
                    "window._wailsAndroidCallback && window._wailsAndroidCallback('%s', null, '%s');",
                    escapeJsString(callbackId),
                    escapeJsString(error)
            );
        } else {
            js = String.format(
                    "window._wailsAndroidCallback && window._wailsAndroidCallback('%s', '%s', null);",
                    escapeJsString(callbackId),
                    escapeJsString(result != null ? result : "")
            );
        }

        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    private String escapeJsString(String str) {
        if (str == null) return "";
        return str.replace("\\", "\\\\")
                .replace("'", "\\'")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                // JS line terminators (U+2028/U+2029) must be escaped too; built via
                // (char) casts so the Java lexer does not reinterpret them as newlines.
                .replace(String.valueOf((char) 0x2028), "\\u2028")
                .replace(String.valueOf((char) 0x2029), "\\u2029");
    }
}

