package com.wails.app;

import android.net.Uri;
import android.util.Log;
import android.webkit.WebResourceResponse;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * WailsPathHandler implements WebViewAssetLoader.PathHandler to serve assets
 * from the Go asset server. This allows the WebView to load assets without
 * using a network server, similar to iOS's WKURLSchemeHandler.
 */
public class WailsPathHandler implements WebViewAssetLoader.PathHandler {
    private static final String TAG = "WailsPathHandler";
    private static final boolean DEBUG = BuildConfig.DEBUG;

    private static String guessMimeType(String path) {
        if (path == null) return "application/octet-stream";
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".html") || path.endsWith(".htm")) return "text/html";
        if (path.endsWith(".wasm")) return "application/wasm";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if (path.endsWith(".gif")) return "image/gif";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".ico")) return "image/x-icon";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".woff")) return "font/woff";
        if (path.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }

    private final WailsBridge bridge;

    public WailsPathHandler(WailsBridge bridge) {
        this.bridge = bridge;
    }

    @Nullable
    @Override
    public WebResourceResponse handle(@NonNull String path) {
        if (DEBUG) Log.d(TAG, "Handling path: " + path);

        // Normalize path
        if (path.isEmpty() || path.equals("/")) {
            path = "/index.html";
        }

        // Strip leading slash — Go embed.FS uses paths without leading /
        String goPath = path.startsWith("/") ? path.substring(1) : path;

        // Get asset from Go
        byte[] data = bridge.serveAsset(goPath, "GET", "{}");

        if (data == null || data.length == 0) {
            Log.w(TAG, "Asset not found: " + path);
            // Fallback: try from Android assets dir
            try {
                InputStream is = bridge.getActivity().getAssets().open(goPath);
                if (is != null) {
                    String mime = bridge.getAssetMimeType(goPath);
                    if (DEBUG) Log.d(TAG, "Fallback serving " + goPath + " from APK assets");
                    return new WebResourceResponse(
                        mime != null ? mime : "application/octet-stream",
                        "UTF-8", 200, "OK", null, is);
                }
            } catch (Exception ignored) {}
            return null;
        }

        // Determine MIME type (try Go first, fallback to extension-based)
        String mimeType = bridge.getAssetMimeType(goPath);
        if (mimeType == null || mimeType.equals("application/octet-stream")) {
            mimeType = guessMimeType(goPath);
        }
        if (DEBUG) Log.d(TAG, "Serving " + path + " with type " + mimeType + " (" + data.length + " bytes)");

        // Create response
        InputStream inputStream = new ByteArrayInputStream(data);
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Cache-Control", "no-cache");

        return new WebResourceResponse(
                mimeType,
                "UTF-8",
                200,
                "OK",
                headers,
                inputStream
        );
    }
}

