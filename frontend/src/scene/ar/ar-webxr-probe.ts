// [doc:architecture] WebXR Probe — ADR-072 P1 支持度探针
// 职责: 探测当前环境的 WebXR immersive-ar 能力，输出兼容性矩阵
// 决策前提: 探针结果决定 WebXR 路线(ADR-072)是否可行，不可行则转原生 ARCore(ADR-073)

import { logWarn } from '@/core/logger';
import { translateGoError } from '@/core/i18n/goerr';

// ======== Types ========

export interface WebXRProbeResult {
    /** navigator.xr 是否存在 */
    xrAvailable: boolean;
    /** immersive-ar session 是否支持 */
    immersiveAR: boolean;
    /** hit-test 特性是否可用 */
    hitTest: boolean;
    /** plane-detection 特性是否可用 */
    planeDetection: boolean;
    /** light-estimation 特性是否可用 */
    lightEstimation: boolean;
    /** anchors 特性是否可用 */
    anchors: boolean;
    /** 用户代理字符串（用于兼容性矩阵） */
    userAgent: string;
    /** 平台标识 */
    platform: string;
    /** 是否为 Android WebView */
    isAndroidWebView: boolean;
    /** 是否为桌面 WebView2 */
    isDesktopWebView2: boolean;
    /** WebView 包名（Android 侧探针回传） */
    webViewPackage?: string;
    /** WebView 版本（Android 侧探针回传） */
    webViewVersion?: string;
    /** 探测时间戳 */
    timestamp: number;
    /** 综合结论 */
    verdict: 'full' | 'partial' | 'none';
    /** 人类可读的结论描述 */
    summary: string;
}

/** Java 侧探针回传的原始数据 */
interface AndroidProbeResult {
    webViewPackage: string;
    webViewVersion: string;
    xrExists: boolean;
    xrIsSessionSupported: boolean;
    userAgent: string;
    error?: string;
}

// ======== Internal ========

let _cachedResult: WebXRProbeResult | null = null;

// Android 侧探针回调注册
declare global {
    interface Window {
        __onWebXRProbeResult?: (json: string) => void;
    }
}

/**
 * 调用 Java 侧 probeWebXRSupport()，等待回调结果。
 * 仅在 Android WebView 环境有效。
 */
function probeAndroidWebView(): Promise<AndroidProbeResult | null> {
    const w = window.wails;
    if (!w || typeof w.probeWebXRSupport !== 'function') {
        return Promise.resolve(null);
    }
    return new Promise<AndroidProbeResult | null>((resolve) => {
        const timeout = setTimeout(() => {
            window.__onWebXRProbeResult = undefined;
            resolve(null);
        }, 5000); // 5s 超时

        window.__onWebXRProbeResult = (json: string) => {
            clearTimeout(timeout);
            window.__onWebXRProbeResult = undefined;
            try {
                resolve(JSON.parse(json) as AndroidProbeResult);
            } catch {
                resolve(null);
            }
        };
        w.probeWebXRSupport!();
    });
}

/**
 * 检测 navigator.xr 是否支持指定 session mode。
 * 若 navigator.xr 不存在或 isSessionSupported 抛异常，返回 false。
 */
async function checkSessionSupported(mode: XRSessionMode): Promise<boolean> {
    if (!navigator.xr) {
        return false;
    }
    try {
        return await navigator.xr.isSessionSupported(mode);
    } catch (e) {
        logWarn('webxr-probe', `isSessionSupported(${mode}) failed:`, e);
        return false;
    }
}

/**
 * 尝试请求一个短暂的 immersive-ar session 来验证特性可用性。
 * 注意：这会实际触发 AR session（摄像头权限弹窗），仅在用户主动触发时调用。
 *
 * @param features 要验证的 optional features 列表
 * @returns 实际被授予的 features 列表
 */
async function probeFeaturesBySession(
    features: string[]
): Promise<{ granted: string[]; error: string | null }> {
    if (!navigator.xr) {
        return { granted: [], error: 'navigator.xr not available' };
    }
    try {
        const session = await navigator.xr.requestSession('immersive-ar', {
            requiredFeatures: ['local-floor'],
            optionalFeatures: features,
        });
        // Session 创建成功——检查实际启用了哪些特性
        const granted: string[] = [];
        // WebXR spec: session.enabledFeatures 可能不存在于所有实现
        const enabled = (session as unknown as { enabledFeatures?: string[] }).enabledFeatures;
        if (Array.isArray(enabled)) {
            for (const f of features) {
                if (enabled.includes(f)) {
                    granted.push(f);
                }
            }
        } else {
            // 回退：session 创建成功即认为 requiredFeatures 可用
            // optionalFeatures 无法确认，标记为 'unknown'
            granted.push(...features.map((f) => `${f}(unconfirmed)`));
        }
        await session.end();
        return { granted, error: null };
    } catch (e) {
        const msg = translateGoError(e);
        return { granted: [], error: msg };
    }
}

// ======== Platform Detection ========

function detectPlatform(): {
    isAndroidWebView: boolean;
    isDesktopWebView2: boolean;
    platform: string;
} {
    const ua = navigator.userAgent;
    const isAndroid = /Android/i.test(ua);
    // Android WebView 的 UA 包含 "wv" 标记或 Version/x.x（Chrome 无此标记）
    const isWebView = /\bwv\b/.test(ua) || (/Version\/[\d.]+/.test(ua) && /Chrome/.test(ua));
    // Wails 桌面端 WebView2 UA 包含 "Edg/" (Edge Chromium)
    const isWebView2 = /Edg\//.test(ua) && !isAndroid;
    // Wails 注入标识
    const hasWails = typeof window.wails !== 'undefined';

    let platform = 'unknown';
    if (isAndroid && isWebView) {
        platform = 'android-webview';
    } else if (isAndroid) {
        platform = 'android-chrome';
    } else if (isWebView2 || (hasWails && !isAndroid)) {
        platform = 'desktop-webview2';
    } else {
        platform = 'desktop-browser';
    }

    return {
        isAndroidWebView: isAndroid && isWebView,
        isDesktopWebView2: isWebView2 || (hasWails && !isAndroid),
        platform,
    };
}

// ======== Public API ========

/**
 * 执行 WebXR 支持度探针（非侵入式，不请求 session）。
 * 结果会被缓存，重复调用返回同一结果。
 * 在 Android WebView 环境下会同时调用 Java 侧探针获取 WebView 包信息。
 */
export async function probeWebXR(): Promise<WebXRProbeResult> {
    if (_cachedResult) {
        return _cachedResult;
    }

    const { isAndroidWebView, isDesktopWebView2, platform } = detectPlatform();
    const xrAvailable = typeof navigator.xr !== 'undefined';

    let immersiveAR = false;
    if (xrAvailable) {
        immersiveAR = await checkSessionSupported('immersive-ar');
    }

    // Android 侧探针：获取 WebView 包名/版本 + Java 侧 navigator.xr 评估
    let webViewPackage: string | undefined;
    let webViewVersion: string | undefined;
    if (isAndroidWebView) {
        const androidResult = await probeAndroidWebView();
        if (androidResult) {
            webViewPackage = androidResult.webViewPackage;
            webViewVersion = androidResult.webViewVersion;
            // Java 侧的结果可能比 JS 侧更准确（同一 WebView 上下文）
            if (androidResult.xrExists && !xrAvailable) {
                // 理论上不应发生，但以防万一
                logWarn('webxr-probe', 'Java-side reports xr exists but JS-side disagrees');
            }
            if (androidResult.xrIsSessionSupported && !immersiveAR) {
                immersiveAR = true;
            }
        }
    }

    // 非侵入式探针无法确认具体 features（需实际创建 session），
    // 这里仅根据 immersive-ar 支持度做初步判断。
    // 完整特性验证需调用 probeWebXRFeatures()（会触发权限弹窗）。
    const hitTest = false;
    const planeDetection = false;
    const lightEstimation = false;
    const anchors = false;

    // 综合结论
    let verdict: 'full' | 'partial' | 'none';
    let summary: string;

    if (!xrAvailable && !immersiveAR) {
        verdict = 'none';
        if (isDesktopWebView2) {
            summary = 'WebView2 无 XR 后端 → 永久降级 passthrough（ADR-072 §1.3 已确认）';
        } else if (isAndroidWebView) {
            const pkgInfo = webViewPackage
                ? ` [WebView: ${webViewPackage} v${webViewVersion}]`
                : '';
            summary =
                `Android WebView 未暴露 navigator.xr → WebXR 默认禁用${pkgInfo}，` +
                '需评估启用机制（flag / WebViewCompat / ROM）';
        } else {
            summary = 'navigator.xr 不存在 → 浏览器不支持 WebXR';
        }
    } else if (!immersiveAR) {
        verdict = 'none';
        summary =
            'navigator.xr 存在但 immersive-ar 不受支持 → ' + '可能仅支持 immersive-vr 或 inline';
    } else {
        // immersive-ar 支持，但具体 features 未验证
        verdict = 'partial';
        summary =
            'immersive-ar 受支持 ✓ — hit-test / plane-detection 等特性需进一步验证' +
            '（调用 probeWebXRFeatures 会触发 AR session + 摄像头权限）';
    }

    _cachedResult = {
        xrAvailable: xrAvailable || immersiveAR, // Java 侧可能确认 xr 存在
        immersiveAR,
        hitTest,
        planeDetection,
        lightEstimation,
        anchors,
        userAgent: navigator.userAgent,
        platform,
        isAndroidWebView,
        isDesktopWebView2,
        webViewPackage,
        webViewVersion,
        timestamp: Date.now(),
        verdict,
        summary,
    };

    return _cachedResult;
}

/**
 * 深度探针：实际创建 immersive-ar session 验证特性可用性。
 * ⚠️ 会触发摄像头权限弹窗，仅在用户主动点击「深度探针」时调用。
 */
export async function probeWebXRFeatures(): Promise<WebXRProbeResult> {
    const base = await probeWebXR();

    if (!base.immersiveAR) {
        // 无法创建 session，直接返回基础结果
        return base;
    }

    const featuresToProbe = ['hit-test', 'plane-detection', 'light-estimation', 'anchors'];
    const { granted, error } = await probeFeaturesBySession(featuresToProbe);

    if (error) {
        // Session 创建失败（权限拒绝等）
        _cachedResult = {
            ...base,
            verdict: 'partial',
            summary: `immersive-ar 支持但 session 创建失败: ${error}`,
        };
        return _cachedResult;
    }

    const has = (f: string) => granted.some((g) => g.startsWith(f));

    const hitTest = has('hit-test');
    const planeDetection = has('plane-detection');
    const lightEstimation = has('light-estimation');
    const anchors = has('anchors');

    // 至少 hit-test 可用才算 'full'
    const verdict: 'full' | 'partial' | 'none' = hitTest ? 'full' : 'partial';
    const parts: string[] = [];
    if (hitTest) parts.push('hit-test ✓');
    if (planeDetection) parts.push('plane-detection ✓');
    if (lightEstimation) parts.push('light-estimation ✓');
    if (anchors) parts.push('anchors ✓');
    const missing = featuresToProbe.filter((f) => !has(f));
    if (missing.length > 0) parts.push(`缺失: ${missing.join(', ')}`);

    _cachedResult = {
        ...base,
        hitTest,
        planeDetection,
        lightEstimation,
        anchors,
        verdict,
        summary: `特性验证: ${parts.join(' | ')}`,
    };

    return _cachedResult;
}

/** 清除缓存的探针结果（用于重新探测）。 */
export function resetProbeCache(): void {
    _cachedResult = null;
}

/**
 * 格式化探针结果为人类可读的多行文本（用于 UI 展示或复制到剪贴板）。
 */
export function formatProbeReport(r: WebXRProbeResult): string {
    const lines: string[] = [
        '═══ WebXR 兼容性探针报告 ═══',
        `平台: ${r.platform}`,
        `时间: ${new Date(r.timestamp).toLocaleString()}`,
    ];
    if (r.webViewPackage) {
        lines.push(`WebView: ${r.webViewPackage} v${r.webViewVersion}`);
    }
    lines.push(
        '',
        `navigator.xr: ${r.xrAvailable ? '✓ 存在' : '✗ 不存在'}`,
        `immersive-ar: ${r.immersiveAR ? '✓ 支持' : '✗ 不支持'}`,
        `hit-test: ${r.hitTest ? '✓' : r.immersiveAR ? '? (未验证)' : '✗'}`,
        `plane-detection: ${r.planeDetection ? '✓' : r.immersiveAR ? '? (未验证)' : '✗'}`,
        `light-estimation: ${r.lightEstimation ? '✓' : r.immersiveAR ? '? (未验证)' : '✗'}`,
        `anchors: ${r.anchors ? '✓' : r.immersiveAR ? '? (未验证)' : '✗'}`,
        '',
        `结论: ${r.verdict === 'full' ? '🟢 WebXR 路线可行' : r.verdict === 'partial' ? '🟡 部分支持，需降级共存' : '🔴 不可行，转 ADR-073 原生路线'}`,
        r.summary,
        '',
        `UA: ${r.userAgent}`
    );
    return lines.join('\n');
}
