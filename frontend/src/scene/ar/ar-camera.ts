// [doc:architecture] AR Camera — 摄像头视频透传与模型叠加
// 规范文档: docs/adr/adr-055-ar-camera-mode.md
// 职责: 管理摄像头视频流, 提供 start/stop/switchFacing 接口, 维护 <video> 元素
// 渲染合成策略: 透明 canvas + CSS <video> 底层 (S2 方案, 性能最优)

import { dom } from '@/core/config';
import { feedbackInfo, feedbackStatus } from '@/core/feedback';
import { getCachedCapabilities } from '@/core/backend';
import { logWarn } from '@/core/logger';
import { canvasToBase64 } from '@/core/image';

// ======== Types ========
export type CameraFacing = 'user' | 'environment';

declare global {
    interface Window {
        // Callback the Android bridge invokes with the CAMERA permission result
        // after requestCameraPermission() (see ensureAndroidCameraPermission).
        __onArcCameraPermission?: (granted: boolean) => void;
    }
}

// ======== Internal State ========
let _active = false;
let _facing: CameraFacing = 'user';
let _stream: MediaStream | null = null;
let _videoEl: HTMLVideoElement | null = null;
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

// ======== Video Element ========
function getVideoEl(): HTMLVideoElement {
    if (_videoEl) {
        return _videoEl;
    }
    // [fix P3] 去掉裸 as：getElementById 返回 HTMLElement，若 DOM 被外部脚本替换为
    // 非 video 节点（或 id 冲突），强转后调用 srcObject/play 会在非 video 上崩溃。
    // instanceof 守卫：类型不符时重建 video 元素。
    const existing = document.getElementById('arVideo');
    let el: HTMLVideoElement | null = existing instanceof HTMLVideoElement ? existing : null;
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

    try {
        if (_active && _facing === facing && _stream) {
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
            feedbackStatus('scene.ar.cameraUnavailable', undefined, false);
            return false;
        }

        // Android WebView：进入 AR 前必须持有 CAMERA 运行时权限，否则 getUserMedia
        // 会被 WebChromeClient 静默拒绝（NotAllowedError）。这里在按钮点击链路里显式
        // 判断授权状态——已授权则继续，未授权则弹系统授权框并等待用户决策。
        // [fix P1] 本 await 位于 try 内：ensureAndroidCameraPermission 已保证不 reject，
        // 此处 try 为第二道防线——任何意外 rejection 由 catch 统一处理，finally 复位 _starting。
        if (
            getCachedCapabilities().arScope === 'android-app' &&
            !(await ensureAndroidCameraPermission())
        ) {
            _active = false;
            _hideVideo();
            feedbackStatus('scene.ar.cameraDenied', undefined, false);
            return false;
        }

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
            return false;
        }

        video.srcObject = _stream;
        await video.play();

        _applyVideoMirror();
        _active = true;
        _showVideo();

        feedbackInfo('scene.ar.enabled', undefined);
        _notifyARModeChange(true);
        return true;
    } catch (err) {
        logWarn('AR', 'startARCamera failed:', err);
        if (_stream) {
            _stream.getTracks().forEach((tr) => tr.stop());
            _stream = null;
        }
        _active = false;
        _hideVideo();
        feedbackStatus('scene.ar.cameraDenied', undefined, false);
        return false;
    } finally {
        // [fix P2] 集中复位启动标志：此前 6 个复位点分散在各 return 前，新增分支漏复位
        // 会卡死 _starting=true 永久阻塞后续启动；finally 保证所有路径（含异常）复位。
        // 注意：重入短路（L90 `if (_starting) return`）在 try 外，不影响在途请求的标志。
        _starting = false;
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
    // [fix P3] 复位镜像覆盖标志：stopARCamera 不清零则下次 startARCamera 时
    // _applyVideoMirror 仍跳过默认镜像逻辑（用户上次 setARMirror 的 overridden
    // 跨会话残留），重新进入 AR 不恢复「前置默认镜像」期望。
    _mirrorOverridden = false;
}

/** 切换前后摄像头。 */
export async function switchARCameraFacing(): Promise<boolean> {
    const nextFacing: CameraFacing = _facing === 'user' ? 'environment' : 'user';
    const ok = await startARCamera(nextFacing);
    if (ok) {
        feedbackInfo(
            nextFacing === 'user' ? 'scene.ar.switchedUser' : 'scene.ar.switchedEnv',
            undefined
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
    return canvasToBase64(dom.canvas, format, quality).then((fallbackBase64) => {
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
        return canvasToBase64(out, format, quality);
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
    // [fix P1] 校验两个 API 都存在：requestCameraPermission 缺失时不可调用，
    // 直接 resolve(true) 走桌面自身 getUserMedia 流程（WebChromeClient 拒绝时
    // 抛 NotAllowedError 由 startARCamera 的 catch 统一处理，而非在此死锁）。
    if (
        !w ||
        typeof w.hasCameraPermission !== 'function' ||
        typeof w.requestCameraPermission !== 'function'
    ) {
        return Promise.resolve(true);
    }
    if (w.hasCameraPermission()) {
        return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
        const prev = window.__onArcCameraPermission;
        // [fix P2] 15s 超时兜底：系统授权框不响应或回调丢失时不再永久挂起
        // （否则 startARCamera 的 await 永远 pending，AR 功能挂死）。
        const timer = setTimeout(() => {
            window.__onArcCameraPermission = prev;
            resolve(false);
        }, 15000);
        window.__onArcCameraPermission = (granted: boolean) => {
            clearTimeout(timer);
            window.__onArcCameraPermission = prev;
            resolve(granted);
        };
        try {
            w.requestCameraPermission();
        } catch (err) {
            // [fix P1] 调用抛异常（Go 绑定层错误）：恢复回调并 resolve(false)，
            // 保证 Promise 绝不 reject——startARCamera 的 _starting 由此永不泄漏。
            clearTimeout(timer);
            window.__onArcCameraPermission = prev;
            logWarn('AR', 'requestCameraPermission failed:', err);
            resolve(false);
        }
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

// [doc:adr-238] 注册 AR 激活状态供 scene/motion 经 scene-action-bridge 查询（切断 scene/motion→scene/ar）
import { registerSceneAction } from '@/core/scene-action-bridge';
registerSceneAction('isARActive', () => isARActive());
