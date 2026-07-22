// [doc:architecture] AR Camera — 摄像头视频透传与模型叠加
// 规范文档: docs/adr/adr-055-ar-camera-mode.md
// 职责: 管理摄像头视频流, 提供 start/stop/switchFacing 接口, 维护 <video> 元素
// 渲染合成策略: 透明 canvas + CSS <video> 底层 (S2 方案, 性能最优)

import { dom, setStatus } from '@/core/config';
import { t } from '@/core/i18n/t';
import { isAndroidPlatform } from '@/core/platform';
import { logWarn } from '@/core/logger';

// ======== Types ========
export type CameraFacing = 'user' | 'environment';

declare global {
    interface Window {
        // Callback the Android bridge invokes with the CAMERA permission result
        // after requestCameraPermission() (see ensureAndroidCameraPermission).
        __onArcCameraPermission?: (granted: boolean) => void;
    }
}

export interface ARCameraState {
    active: boolean;
    facing: CameraFacing;
    streamId: string | null;
}

// ======== Internal State ========
let _active = false;
let _facing: CameraFacing = 'user';
let _stream: MediaStream | null = null;
let _videoEl: HTMLVideoElement | null = null;
const _originalClearColor: { r: number; g: number; b: number; a: number } | null = null;
let _mirrorOverridden = false; // 用户是否手动设置过镜像
type ARModeChangeListener = (active: boolean) => void;
const _listeners: ARModeChangeListener[] = [];

// 代数令牌：每次发起/终止 AR 都会自增，用于作废在途的异步 getUserMedia。
// 典型竞态：进入 AR 时 getUserMedia 弹窗未关闭，用户已切走——stopARCamera 会 bump
// 此令牌，pending 的 startARCamera 在 await 后检测到 myGen !== _arGen 即丢弃流并 return false，
// 避免"幽灵 AR"（isARActive()===true 但已离开 AR 模式）。
let _arGen = 0;
// 防重入：避免并发双 getUserMedia 泄漏摄像头流。
let _starting = false;

function _notifyARModeChange(active: boolean): void {
    for (const fn of _listeners) {
        try {
            fn(active);
        } catch (e) {
            console.error('[ar-camera] listener error:', e);
        }
    }
}

/** 订阅 AR 模式切换事件，返回取消订阅函数。 */
export function addARModeChangeListener(fn: ARModeChangeListener): () => void {
    _listeners.push(fn);
    return () => {
        const i = _listeners.indexOf(fn);
        if (i >= 0) {
            _listeners.splice(i, 1);
        }
    };
}

// ======== Video Element ========
function getVideoEl(): HTMLVideoElement {
    if (_videoEl) {
        return _videoEl;
    }
    let el = document.getElementById('arVideo') as HTMLVideoElement | null;
    if (!el) {
        el = document.createElement('video');
        el.id = 'arVideo';
        el.autoplay = true;
        el.playsInline = true;
        el.muted = true;
        el.setAttribute('aria-hidden', 'true');
        const canvas = dom.canvas;
        if (canvas.parentElement) {
            canvas.parentElement.insertBefore(el, canvas);
        } else {
            document.body.appendChild(el);
        }
    }
    _videoEl = el;
    return el;
}

// ======== Public API ========
export function isARActive(): boolean {
    return _active;
}

export function getARFacing(): CameraFacing {
    return _facing;
}

export function getARVideoEl(): HTMLVideoElement | null {
    return _videoEl;
}

/**
 * 启动 AR 摄像头并显示视频背景。
 * @param facing 前置(user)或后置(environment)
 * @returns 是否成功启动
 */
export async function startARCamera(facing: CameraFacing = 'user'): Promise<boolean> {
    // 串行化：已有启动在途时直接返回当前状态，避免并发双 getUserMedia 泄漏流。
    if (_starting) {
        return _active;
    }
    _starting = true;
    // 占用一个代数；随后任意 stopARCamera 或新的 startARCamera 都会使本代数失效。
    const myGen = ++_arGen;

    if (_active && _facing === facing && _stream) {
        _starting = false;
        return true;
    }

    // 停止旧流（内联停止，不 bump 代数——我们马上会用新流替换它）。
    if (_stream) {
        const old = _stream;
        _stream = null;
        old.getTracks().forEach((tr) => tr.stop());
        if (_videoEl) {
            _videoEl.srcObject = null;
        }
        _active = false;
        _hideVideo();
    }

    const video = getVideoEl();
    _facing = facing;

    // 环境不支持（如 Wails/WebView2 未声明 media 能力）：navigator.mediaDevices 可能为 undefined。
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        _active = false;
        _hideVideo();
        setStatus(t('scene.ar.cameraUnavailable'), false);
        _starting = false;
        return false;
    }

    // Android WebView：进入 AR 前必须持有 CAMERA 运行时权限，否则 getUserMedia
    // 会被 WebChromeClient 静默拒绝（NotAllowedError）。这里在按钮点击链路里显式
    // 判断授权状态——已授权则继续，未授权则弹系统授权框并等待用户决策。
    if (isAndroidPlatform() && !(await ensureAndroidCameraPermission())) {
        _active = false;
        _hideVideo();
        setStatus(t('scene.ar.cameraDenied'), false);
        _starting = false;
        return false;
    }

    try {
        const constraints: MediaStreamConstraints = {
            video: {
                facingMode: facing,
                width: { ideal: 1280 },
                height: { ideal: 720 },
            } as MediaTrackConstraints,
            audio: false,
        };

        _stream = await navigator.mediaDevices.getUserMedia(constraints);

        // 关键：await 之后校验代数是否仍有效（期间可能已被 stopARCamera 或新切换作废）。
        if (myGen !== _arGen) {
            _stream.getTracks().forEach((tr) => tr.stop());
            _stream = null;
            _active = false;
            _hideVideo();
            _starting = false;
            return false;
        }

        video.srcObject = _stream;
        await video.play();

        _applyVideoMirror();
        _active = true;
        _showVideo();

        setStatus(t('scene.ar.enabled'), true);
        _notifyARModeChange(true);
        _starting = false;
        return true;
    } catch (err) {
        logWarn('AR', 'startARCamera failed:', err);
        if (_stream) {
            _stream.getTracks().forEach((tr) => tr.stop());
            _stream = null;
        }
        _active = false;
        _hideVideo();
        setStatus(t('scene.ar.cameraDenied'), false);
        _starting = false;
        return false;
    }
}

/** 停止 AR 摄像头，释放资源并隐藏视频背景。 */
export function stopARCamera(): void {
    // 作废任何在途的 startARCamera（其 await 后会检测到代数失效并丢弃流）。
    _arGen++;
    if (_stream) {
        const tracks = _stream.getTracks();
        for (const track of tracks) {
            track.stop();
        }
        _stream = null;
    }
    if (_videoEl) {
        _videoEl.srcObject = null;
    }
    _active = false;
    _hideVideo();
    _notifyARModeChange(false);
}

/** 切换前后摄像头。 */
export async function switchARCameraFacing(): Promise<boolean> {
    const nextFacing: CameraFacing = _facing === 'user' ? 'environment' : 'user';
    const ok = await startARCamera(nextFacing);
    if (ok) {
        setStatus(
            nextFacing === 'user' ? t('scene.ar.switchedUser') : t('scene.ar.switchedEnv'),
            true
        );
    }
    return ok;
}

/** 设置是否镜像显示（前置默认镜像，后置默认不镜像）。用户手动调用后标记为 overridden，切换摄像头时保持用户设置。 */
export function setARMirror(mirrored: boolean): void {
    _mirrorOverridden = true;
    const el = getVideoEl();
    el.style.transform = mirrored ? 'scaleX(-1)' : 'scaleX(1)';
}

/** 当前是否镜像显示。 */
export function isARMirrored(): boolean {
    const el = getVideoEl();
    return el.style.transform === 'scaleX(-1)';
}

/**
 * 截取 AR 合成画面（视频底 + 3D 模型层）。
 * 异步版：用 toBlob 替代 toDataURL，将 PNG/JPEG 编码移至后台线程，
 * 避免低端 Android 机同步编码 OOM（ADR-017 A2-04）。
 * @param format 图片格式，默认 image/png
 * @param quality 质量 0~1，默认 0.9
 * @returns base64 字符串（不含 data:image/xxx;base64, 前缀）
 */
export function captureARScreenshot(
    format: string = 'image/png',
    quality: number = 0.9
): Promise<string> {
    return _canvasToBase64(dom.canvas, format, quality).then((fallbackBase64) => {
        if (!_active || !_videoEl) {
            return fallbackBase64;
        }
        const video = _videoEl;
        const out = document.createElement('canvas');
        out.width = dom.canvas.width;
        out.height = dom.canvas.height;
        const ctx = out.getContext('2d');
        if (!ctx) {
            return fallbackBase64;
        }

        const vw = video.videoWidth || dom.canvas.width;
        const vh = video.videoHeight || dom.canvas.height;
        const cw = dom.canvas.width;
        const ch = dom.canvas.height;

        const vRatio = vw / vh;
        const cRatio = cw / ch;

        let sx = 0,
            sy = 0,
            sw = vw,
            sh = vh;
        if (vRatio > cRatio) {
            sw = vh * cRatio;
            sx = (vw - sw) / 2;
        } else {
            sh = vw / cRatio;
            sy = (vh - sh) / 2;
        }

        try {
            ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch);
        } catch (e) {
            logWarn('AR', 'drawImage video failed:', e);
        }

        ctx.drawImage(dom.canvas, 0, 0, cw, ch);
        return _canvasToBase64(out, format, quality);
    });
}

/**
 * canvas → base64 异步编码（替代同步 toDataURL）。
 * toBlob 将 PNG/JPEG 编码移至后台线程（Chrome Skia encoder），不阻塞主线程，
 * 内存峰值显著低于 toDataURL（后者一次性生成完整 data URL 字符串）。
 * 回退路径：toBlob 不可用或返回 null 时降级 toDataURL（受约束环境兼容）。
 */
function _canvasToBase64(
    canvas: HTMLCanvasElement,
    format: string,
    quality: number
): Promise<string> {
    return new Promise((resolve) => {
        canvas.toBlob(
            (blob) => {
                if (!blob) {
                    // toBlob 返回 null（受约束环境或编码失败）→ 降级 toDataURL
                    resolve(
                        canvas.toDataURL(format, quality).replace(/^data:image\/\w+;base64,/, '')
                    );
                    return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                    const result = reader.result;
                    if (typeof result === 'string') {
                        resolve(result.replace(/^data:image\/\w+;base64,/, ''));
                    } else {
                        resolve(
                            canvas.toDataURL(format, quality).replace(/^data:image\/\w+;base64,/, '')
                        );
                    }
                };
                reader.onerror = () => {
                    resolve(
                        canvas.toDataURL(format, quality).replace(/^data:image\/\w+;base64,/, '')
                    );
                };
                reader.readAsDataURL(blob);
            },
            format,
            quality
        );
    });
}

// ======== Internal Helpers ========
/**
 * 在 Android 上确保 CAMERA 运行时权限已授予，再允许 getUserMedia。
 * - 非 Android / 无桥接：直接 resolve(true)，走桌面自身逻辑。
 * - 已授权：立即 resolve(true)。
 * - 未授权：调用 Java 侧 requestCameraPermission() 弹出系统授权框，
 *   并以 window.__onArcCameraPermission(granted) 回调返回用户决策。
 */
function ensureAndroidCameraPermission(): Promise<boolean> {
    const w = window.wails;
    if (!w || typeof w.hasCameraPermission !== 'function') {
        return Promise.resolve(true);
    }
    if (w.hasCameraPermission()) {
        return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
        const prev = window.__onArcCameraPermission;
        window.__onArcCameraPermission = (granted: boolean) => {
            window.__onArcCameraPermission = prev;
            resolve(granted);
        };
        w.requestCameraPermission!();
    });
}

function _showVideo(): void {
    const video = getVideoEl();
    video.style.display = 'block';
}

function _hideVideo(): void {
    if (_videoEl) {
        _videoEl.style.display = 'none';
    }
}

function _applyVideoMirror(): void {
    if (_mirrorOverridden) {
        return; // 用户手动设置过，保持用户设置
    }
    const video = getVideoEl();
    if (_facing === 'user') {
        video.style.transform = 'scaleX(-1)';
    } else {
        video.style.transform = 'none';
    }
}
