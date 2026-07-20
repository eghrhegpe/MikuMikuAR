package com.wails.app;

import android.app.Activity;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.FrameLayout;
import android.widget.TextView;

/**
 * Vuforia × WebView 共存探针（占位实现）。
 *
 * ⚠️ Vuforia SDK 需要手动集成：
 * 1. 访问 https://developer.vuforia.com 注册账号
 * 2. 下载 Vuforia Engine SDK for Android (AAR)
 * 3. 将 AAR 放入 build/android/app/libs/
 * 4. 在 build.gradle 添加: implementation files('libs/VuforiaEngine-10.x.x.aar')
 * 5. 取消注释本文件中的 Vuforia 初始化代码
 *
 * 当前为占位实现，显示集成指引。
 */
public class VuforiaProbeActivity extends Activity {
    private static final String TAG = "VuforiaProbe";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout container = new FrameLayout(this);
        container.setBackgroundColor(0xFF1a1a2e);

        TextView info = new TextView(this);
        info.setTextColor(0xFFFFAA00);
        info.setTextSize(15);
        info.setPadding(48, 96, 48, 48);
        info.setLineSpacing(8, 1.2f);
        info.setText(
            "═══ Vuforia 探针 ═══\n\n" +
            "⚠️ Vuforia SDK 未集成\n\n" +
            "Vuforia 是 ARCore 的替代方案，\n" +
            "支持更多国产设备（高通芯片）。\n\n" +
            "── 集成步骤 ──\n\n" +
            "1. 访问 developer.vuforia.com\n" +
            "   注册免费开发者账号\n\n" +
            "2. 下载 Vuforia Engine SDK\n" +
            "   选择 Android 版本 (AAR)\n\n" +
            "3. 将 AAR 放入:\n" +
            "   build/android/app/libs/\n\n" +
            "4. 修改 build.gradle:\n" +
            "   implementation files('libs/VuforiaEngine-*.aar')\n\n" +
            "5. 获取 License Key:\n" +
            "   developer.vuforia.com/license-manager\n\n" +
            "6. 重新构建 APK\n\n" +
            "── 替代方案 ──\n\n" +
            "• EasyAR (国产 SDK，中文文档)\n" +
            "  easyar.com\n\n" +
            "• 当前降级方案:\n" +
            "  摄像头透传 + 接触阴影 + Gaze 协同\n" +
            "  (已可用，无需额外 SDK)\n\n" +
            "点击返回键退出"
        );

        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
                Gravity.CENTER);
        container.addView(info, params);

        setContentView(container);

        // 报告结果：SDK 未集成
        android.content.Intent result = new android.content.Intent();
        result.putExtra("success", false);
        result.putExtra("vuforiaInitialized", false);
        result.putExtra("cameraStarted", false);
        result.putExtra("webViewOverlay", false);
        result.putExtra("frameCount", 0);
        result.putExtra("error", "Vuforia SDK 未集成，需手动下载 AAR");
        setResult(RESULT_OK, result);
    }
}
