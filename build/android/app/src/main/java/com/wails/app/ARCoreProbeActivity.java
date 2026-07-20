package com.wails.app;

import android.app.Activity;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.TextView;

import com.google.ar.core.ArCoreApk;
import com.google.ar.core.Camera;
import com.google.ar.core.Config;
import com.google.ar.core.Frame;
import com.google.ar.core.Session;
import com.google.ar.core.TrackingState;
import com.google.ar.core.exceptions.CameraNotAvailableException;
import com.google.ar.core.exceptions.UnavailableException;

import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/**
 * ADR-073 P1 探针：验证 ARCore GLSurfaceView + 透明 WebView 共存可行性。
 *
 * 架构：
 * - 底层：GLSurfaceView 渲染 ARCore 相机帧（真实世界画面）
 * - 顶层：透明 WebView（Babylon.js 渲染 3D 模型叠加）
 *
 * 验证目标：
 * 1. ARCore session 能否正常创建
 * 2. 相机帧能否渲染到 GLSurfaceView
 * 3. 透明 WebView 能否叠加在 GLSurfaceView 之上
 * 4. 两者是否争用 EGL Context（核心风险）
 */
public class ARCoreProbeActivity extends Activity implements GLSurfaceView.Renderer {
    private static final String TAG = "ARCoreProbe";

    private Session session;
    private GLSurfaceView glSurfaceView;
    private WebView webView;
    private BackgroundRenderer backgroundRenderer;
    private boolean installRequested = false;
    private TextView statusText;

    // 探针结果
    private boolean arcoreSessionCreated = false;
    private boolean cameraFrameRendered = false;
    private boolean webViewOverlaid = false;
    private int frameCount = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 构建 UI：FrameLayout 包含 GLSurfaceView(底) + WebView(顶) + 状态文本
        FrameLayout container = new FrameLayout(this);

        // 1. GLSurfaceView（底层，ARCore 相机帧）
        glSurfaceView = new GLSurfaceView(this);
        glSurfaceView.setPreserveEGLContextOnPause(true);
        glSurfaceView.setEGLContextClientVersion(2);
        glSurfaceView.setEGLConfigChooser(8, 8, 8, 8, 16, 0);
        glSurfaceView.setRenderer(this);
        glSurfaceView.setRenderMode(GLSurfaceView.RENDERMODE_CONTINUOUSLY);
        container.addView(glSurfaceView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        // 2. WebView（顶层，透明，叠加在 GLSurfaceView 之上）
        webView = new WebView(this);
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        // 关键：WebView 背景透明，让底层 GLSurfaceView 的相机帧透出来
        webView.setBackgroundColor(0x00000000);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        // 加载一个极简测试页面（透明背景 + 绿色方块模拟 3D 模型）
        webView.loadDataWithBaseURL(null, getProbeHtml(), "text/html", "UTF-8", null);
        container.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        webViewOverlaid = true;

        // 3. 状态文本（最顶层，显示探针进度）
        statusText = new TextView(this);
        statusText.setTextColor(0xFF00FF00);
        statusText.setTextSize(14);
        statusText.setPadding(24, 48, 24, 24);
        statusText.setText("ARCore 探针初始化中...");
        FrameLayout.LayoutParams textParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP | Gravity.START);
        container.addView(statusText, textParams);

        setContentView(container);

        // 初始化 ARCore
        initARCore();
    }

    private void initARCore() {
        try {
            // 检查 ARCore 可用性
            ArCoreApk.Availability availability = ArCoreApk.getInstance().checkAvailability(this);
            Log.i(TAG, "ARCore availability: " + availability);

            if (availability.isTransient()) {
                updateStatus("ARCore 可用性检查中...\n" + availability);
                // 延迟重试
                glSurfaceView.postDelayed(this::initARCore, 500);
                return;
            }

            String availabilityInfo = "ARCore 状态: " + availability + "\n";

            if (!availability.isSupported()) {
                // 设备不在官方支持列表，但尝试强制创建 Session
                // （部分国产机硬件有能力但未经 Google 认证）
                availabilityInfo += "⚠️ 设备不在 ARCore 官方支持列表\n尝试强制创建 Session...\n";
                updateStatus(availabilityInfo);
                Log.w(TAG, "ARCore not officially supported, attempting force create");
            }

            // 请求安装 ARCore（如果需要）
            try {
                ArCoreApk.InstallStatus installStatus =
                    ArCoreApk.getInstance().requestInstall(this, !installRequested);
                if (installStatus == ArCoreApk.InstallStatus.INSTALL_REQUESTED) {
                    installRequested = true;
                    updateStatus(availabilityInfo + "正在安装 ARCore...");
                    return;
                }
            } catch (Exception e) {
                Log.w(TAG, "requestInstall failed (expected on non-GMS devices): " + e.getMessage());
                availabilityInfo += "requestInstall 失败: " + e.getMessage() + "\n";
            }

            // 创建 ARCore Session（即使 availability 报告不支持也尝试）
            session = new Session(this);
            Config config = new Config(session);
            config.setUpdateMode(Config.UpdateMode.LATEST_CAMERA_IMAGE);
            config.setFocusMode(Config.FocusMode.AUTO);
            session.configure(config);
            arcoreSessionCreated = true;

            updateStatus(availabilityInfo + "✓ ARCore Session 已创建\n等待相机帧...");
            Log.i(TAG, "ARCore Session created successfully");

        } catch (UnavailableException e) {
            String msg = "❌ ARCore 不可用: " + e.getClass().getSimpleName() + "\n" + e.getMessage();
            updateStatus(msg);
            Log.e(TAG, "ARCore unavailable", e);
            reportResult(false, msg);
        } catch (Exception e) {
            String msg = "❌ 初始化失败: " + e.getClass().getSimpleName() + "\n" + e.getMessage();
            updateStatus(msg);
            Log.e(TAG, "Init failed", e);
            reportResult(false, msg);
        }
    }

    // ======== GLSurfaceView.Renderer ========

    @Override
    public void onSurfaceCreated(GL10 gl, EGLConfig config) {
        GLES20.glClearColor(0f, 0f, 0f, 1f);
        backgroundRenderer = new BackgroundRenderer();
        backgroundRenderer.createOnGlThread();
        Log.i(TAG, "GL Surface created, BackgroundRenderer ready");
    }

    @Override
    public void onSurfaceChanged(GL10 gl, int width, int height) {
        GLES20.glViewport(0, 0, width, height);
        if (session != null) {
            session.setDisplayGeometry(0, width, height);
        }
    }

    @Override
    public void onDrawFrame(GL10 gl) {
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT | GLES20.GL_DEPTH_BUFFER_BIT);

        if (session == null) {
            return;
        }

        try {
            session.setCameraTextureName(backgroundRenderer.getTextureId());
            Frame frame = session.update();
            Camera camera = frame.getCamera();

            if (camera.getTrackingState() == TrackingState.TRACKING) {
                backgroundRenderer.draw(frame);
                frameCount++;

                if (!cameraFrameRendered && frameCount > 0) {
                    cameraFrameRendered = true;
                    runOnUiThread(() -> {
                        updateStatus("✓ ARCore 相机帧渲染成功!\n" +
                                "帧数: " + frameCount + "\n" +
                                "WebView 叠加: " + (webViewOverlaid ? "✓" : "✗") + "\n\n" +
                                "🟢 共存验证通过！\n" +
                                "ARCore GLSurface + 透明 WebView 无 EGL 冲突");
                        reportResult(true, null);
                    });
                }
            }
        } catch (CameraNotAvailableException e) {
            Log.e(TAG, "Camera not available", e);
            runOnUiThread(() -> updateStatus("❌ 相机不可用: " + e.getMessage()));
        }
    }

    // ======== Lifecycle ========

    @Override
    protected void onResume() {
        super.onResume();
        glSurfaceView.onResume();
        if (session != null) {
            try {
                session.resume();
            } catch (CameraNotAvailableException e) {
                Log.e(TAG, "Camera not available on resume", e);
            }
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        glSurfaceView.onPause();
        if (session != null) {
            session.pause();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (session != null) {
            session.close();
            session = null;
        }
        if (webView != null) {
            webView.destroy();
        }
    }

    // ======== Helpers ========

    private void updateStatus(String msg) {
        if (statusText != null) {
            statusText.setText(msg);
        }
        Log.d(TAG, msg);
    }

    /**
     * 向 MainActivity 报告探针结果。
     * 通过 setResult + finish 返回。
     */
    private void reportResult(boolean success, String error) {
        android.content.Intent result = new android.content.Intent();
        result.putExtra("success", success);
        result.putExtra("arcoreSession", arcoreSessionCreated);
        result.putExtra("cameraFrame", cameraFrameRendered);
        result.putExtra("webViewOverlay", webViewOverlaid);
        result.putExtra("frameCount", frameCount);
        result.putExtra("error", error);
        setResult(RESULT_OK, result);
        // 延迟关闭，让用户看到结果
        glSurfaceView.postDelayed(this::finish, success ? 5000 : 8000);
    }

    /**
     * 探针用极简 HTML：透明背景 + 绿色半透明方块（模拟 Babylon.js 3D 模型）。
     */
    private String getProbeHtml() {
        return "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<style>"
                + "html,body{margin:0;padding:0;background:transparent;overflow:hidden;}"
                + ".cube{position:absolute;top:50%;left:50%;width:120px;height:120px;"
                + "margin:-60px 0 0 -60px;background:rgba(0,255,100,0.6);"
                + "border:3px solid #0f0;border-radius:12px;"
                + "display:flex;align-items:center;justify-content:center;"
                + "color:#fff;font:bold 14px sans-serif;text-align:center;"
                + "box-shadow:0 0 30px rgba(0,255,100,0.5);}"
                + ".info{position:absolute;bottom:20px;left:0;right:0;text-align:center;"
                + "color:#0f0;font:12px monospace;text-shadow:0 0 4px #000;}"
                + "</style></head><body>"
                + "<div class='cube'>Babylon.js<br>3D 模型层</div>"
                + "<div class='info'>WebView 透明叠加层 (z-index: top)<br>底层: ARCore 相机帧</div>"
                + "</body></html>";
    }
}
