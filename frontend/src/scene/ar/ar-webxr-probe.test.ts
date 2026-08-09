// ar-webxr-probe.test.ts — WebXR 探针的纯逻辑层（detectPlatform / buildVerdict / formatProbeReport）
// 目标：ar-webxr-probe.ts 覆盖率 0% → 高覆盖。三个纯函数不依赖 Babylon/全局副作用，
// detectPlatform/buildVerdict 从副作用流程中抽出（先写测试再抽）。
import { describe, it, expect } from 'vitest';
import {
    detectPlatform,
    buildVerdict,
    formatProbeReport,
    type WebXRProbeResult,
} from './ar-webxr-probe';

// ═══════════════════════════════════════════════════════
// detectPlatform — UA 平台判定（纯函数）
// ═══════════════════════════════════════════════════════
describe('detectPlatform（UA 平台判定）', () => {
    it('Android WebView（UA 含 wv）→ android-webview', () => {
        const r = detectPlatform(
            'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 wv',
            false
        );
        expect(r.platform).toBe('android-webview');
        expect(r.isAndroidWebView).toBe(true);
        expect(r.isDesktopWebView2).toBe(false);
    });

    it('Android Chrome（UA 无 wv 无 Version）→ android-chrome', () => {
        const r = detectPlatform(
            'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/116.0.0.0 Mobile Safari/537.36',
            false
        );
        expect(r.platform).toBe('android-chrome');
        expect(r.isAndroidWebView).toBe(false);
    });

    it('Windows Edge（UA 含 Edg/）→ desktop-webview2', () => {
        const r = detectPlatform(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
            false
        );
        expect(r.platform).toBe('desktop-webview2');
        expect(r.isDesktopWebView2).toBe(true);
    });

    it('桌面 Chrome + Wails 注入标识 → desktop-webview2（hasWails 兜底）', () => {
        const r = detectPlatform(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            true
        );
        expect(r.platform).toBe('desktop-webview2');
        expect(r.isDesktopWebView2).toBe(true);
    });

    it('桌面 Chrome 无 Wails → desktop-browser', () => {
        const r = detectPlatform(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            false
        );
        expect(r.platform).toBe('desktop-browser');
        expect(r.isDesktopWebView2).toBe(false);
    });

    it('Android + hasWails 不误判为 WebView2（!isAndroid 守卫）', () => {
        const r = detectPlatform(
            'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/116.0.0.0 Mobile Safari/537.36',
            true
        );
        expect(r.isDesktopWebView2).toBe(false);
        expect(r.platform).toBe('android-chrome');
    });

    it('Android UA 含 Version/x.x + Chrome（旧 WebView 形态）→ android-webview', () => {
        const r = detectPlatform(
            'Mozilla/5.0 (Linux; U; Android 11) AppleWebKit/537.36 Version/4.0 Chrome/66.0.3359.158 Mobile Safari/537.36',
            false
        );
        expect(r.platform).toBe('android-webview');
        expect(r.isAndroidWebView).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════
// buildVerdict — 综合结论决策表（纯函数）
// ═══════════════════════════════════════════════════════
describe('buildVerdict（综合结论决策表）', () => {
    it('WebView2 无 XR → none + 永久降级 passthrough', () => {
        const r = buildVerdict({
            xrAvailable: false,
            immersiveAR: false,
            isDesktopWebView2: true,
            isAndroidWebView: false,
        });
        expect(r.verdict).toBe('none');
        expect(r.summary).toContain('WebView2 无 XR 后端');
    });

    it('Android WebView 无 XR → none + 带 WebView 包信息', () => {
        const r = buildVerdict({
            xrAvailable: false,
            immersiveAR: false,
            isDesktopWebView2: false,
            isAndroidWebView: true,
            webViewPackage: 'com.google.android.webview',
            webViewVersion: '120.0.0.0',
        });
        expect(r.verdict).toBe('none');
        expect(r.summary).toContain('[WebView: com.google.android.webview v120.0.0.0]');
    });

    it('Android WebView 无包信息 → 不带 pkg 后缀', () => {
        const r = buildVerdict({
            xrAvailable: false,
            immersiveAR: false,
            isDesktopWebView2: false,
            isAndroidWebView: true,
        });
        expect(r.summary).toContain('Android WebView 未暴露 navigator.xr');
        expect(r.summary).not.toContain('[WebView:');
    });

    it('普通浏览器无 XR → none + 浏览器不支持', () => {
        const r = buildVerdict({
            xrAvailable: false,
            immersiveAR: false,
            isDesktopWebView2: false,
            isAndroidWebView: false,
        });
        expect(r.verdict).toBe('none');
        expect(r.summary).toContain('浏览器不支持 WebXR');
    });

    it('xr 存在但 immersive-ar 不支持 → none', () => {
        const r = buildVerdict({
            xrAvailable: true,
            immersiveAR: false,
            isDesktopWebView2: false,
            isAndroidWebView: false,
        });
        expect(r.verdict).toBe('none');
        expect(r.summary).toContain('immersive-ar 不受支持');
    });

    it('immersive-ar 支持 → partial + 特性待验证', () => {
        const r = buildVerdict({
            xrAvailable: true,
            immersiveAR: true,
            isDesktopWebView2: false,
            isAndroidWebView: false,
        });
        expect(r.verdict).toBe('partial');
        expect(r.summary).toContain('hit-test / plane-detection 等特性需进一步验证');
    });
});

// ═══════════════════════════════════════════════════════
// formatProbeReport — 人类可读报告（已导出纯函数，零测试补锁）
// ═══════════════════════════════════════════════════════
describe('formatProbeReport（报告格式化）', () => {
    const base: WebXRProbeResult = {
        xrAvailable: true,
        immersiveAR: true,
        hitTest: false,
        planeDetection: false,
        lightEstimation: false,
        anchors: false,
        userAgent: 'Test UA',
        platform: 'desktop-browser',
        isAndroidWebView: false,
        isDesktopWebView2: false,
        timestamp: 0,
        verdict: 'partial',
        summary: 'immersive-ar 受支持 ✓ — hit-test / plane-detection 等特性需进一步验证',
    };

    it('含 WebView 包信息时输出 WebView 行', () => {
        const report = formatProbeReport({
            ...base,
            webViewPackage: 'pkg-a',
            webViewVersion: '1.2.3',
        });
        expect(report).toContain('WebView: pkg-a v1.2.3');
        expect(report).toContain('平台: desktop-browser');
        expect(report).toContain(`时间: ${new Date(0).toLocaleString()}`);
        expect(report).toContain('navigator.xr: ✓ 存在');
        expect(report).toContain('immersive-ar: ✓ 支持');
        expect(report).toContain('hit-test: ? (未验证)');
        expect(report).toContain('🟡 部分支持，需降级共存');
        expect(report).toContain('UA: Test UA');
    });

    it('无 WebView 包信息时不输出 WebView 行', () => {
        const report = formatProbeReport(base);
        expect(report).not.toContain('WebView:');
    });

    it('verdict 三种状态输出对应结论', () => {
        const full = formatProbeReport({ ...base, verdict: 'full' });
        expect(full).toContain('🟢 WebXR 路线可行');
        const partial = formatProbeReport({ ...base, verdict: 'partial' });
        expect(partial).toContain('🟡 部分支持，需降级共存');
        const none = formatProbeReport({
            ...base,
            verdict: 'none',
            xrAvailable: false,
            immersiveAR: false,
        });
        expect(none).toContain('🔴 不可行，转 ADR-073 原生路线');
    });

    it('特性已确认时输出 ✓ 而非未验证', () => {
        const report = formatProbeReport({ ...base, hitTest: true, planeDetection: true });
        expect(report).toContain('hit-test: ✓');
        expect(report).toContain('plane-detection: ✓');
    });
});
