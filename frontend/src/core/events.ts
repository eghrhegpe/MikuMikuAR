// [doc:adr-102] Event handlers — split from main.ts (P3).
// Aggregates DOM/window event listeners, drag-drop import, and update toasts.
// Pure Split-layer module: it imports from leaf/domain layers but is never
// imported by them (no cycle).
// [doc:adr-238] 导航/overlay UI 逻辑已下沉 menus/nav-actions（core 不反向依赖 UI 层）；
// 本模块经 core/ui-action-bridge 调用 navAction/toggleOverlayMode。
import {
    dom,
    isPlaying,
    setIsPlaying,
    autoLoop,
    setAutoLoop,
    seekDragging,
    setSeekDragging,
    mmdRuntime,
    setPopupOpen,
    setStatus,
} from './config';
import { getUiAction } from './ui-action-bridge';
import { DownloadApk } from '../core/wails-bindings';
import { freeflyInput } from './freefly-state';
import { orbitInput } from './orbit-state';
// [doc:adr-238] scene 操作经 scene-action-bridge（scene 侧注册）
import { getSceneAction } from './scene-action-bridge';
import { t } from './i18n/t';
import { openExternalLink } from './platform';
import { getCachedCapabilities } from './backend';
import { addDisposableListener } from './dom';

// [adr:audit] 统一收集 app 级事件监听，支持幂等清理（防 HMR 重复绑定）。
// 所有 register* 函数改用 _reg 注册；disposeEventHandlers() 在 init 入口统一销毁。
const _eventDisposables: { dispose(): void }[] = [];
// handler 以 any 接收：wrapper 无法复刻 DOM addEventListener 的事件名重载
// （keyof WindowEventMap），集中豁免单点，避免给 17 处调用逐一补事件类型注解。
function _reg(
    target: EventTarget,
    event: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (evt: any) => void,
    options?: AddEventListenerOptions
): void {
    _eventDisposables.push(addDisposableListener(target, event, handler, options));
}
export function disposeEventHandlers(): void {
    for (const d of _eventDisposables) {
        d.dispose();
    }
    _eventDisposables.length = 0;
    _activePointerCount = 0;
}

import { handleDroppedFile } from './drop-import';

// ======== Module-level state ========
let seekWasPlaying = false;
let _pointerDownPos = { x: 0, y: 0 };
const _lastTapTime = 0;
let _activePointerCount = 0; // 活跃指针计数；仅单指时执行 click/toggle

// ======== Register all DOM/window event listeners ========
export function registerEventHandlers(): void {
    // Play/Pause — only toggles play state, does NOT touch autoLoop
    _reg(dom.btnPlayPause, 'click', async () => {
        if (!mmdRuntime) {
            return;
        }
        if (isPlaying) {
            mmdRuntime.pauseAnimation();
            setIsPlaying(false);
        } else {
            await mmdRuntime.playAnimation();
            setIsPlaying(true);
        }
        getSceneAction('updatePlaybackUI')?.();
    });

    // Loop toggle
    _reg(dom.btnLoopToggle, 'click', () => {
        setAutoLoop(!autoLoop);
        getSceneAction('updatePlaybackUI')?.();
        setStatus(t('status.loop', { state: autoLoop ? t('common.on') : t('common.off') }), true);
    });

    // ======== Ctrl shortcuts hint ========
    _reg(window, 'keydown', (e) => {
        if (e.key === 'Control' && !e.repeat) {
            document.body.classList.add('shortcuts-visible');
        }
    });
    _reg(window, 'keyup', (e) => {
        if (e.key === 'Control') {
            document.body.classList.remove('shortcuts-visible');
        }
    });
    _reg(window, 'blur', () => document.body.classList.remove('shortcuts-visible'));

    // ======== Freefly WASD (only respond in freefly mode) ========
    // keydown 完整守卫（模式 + 输入框 + 菜单）：避免在输入框打字或菜单导航时误触发移动。
    // keyup 只查模式、不受守卫限制：保证松键总能清标记，避免相机“卡住”持续移动（同 orbit 模式）。
    const _freeflyKeyActive = (t: HTMLElement | null): boolean => {
        if ((getSceneAction('getCameraMode')?.() ?? 'orbit') !== 'freefly') {
            return false;
        }
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
            return false;
        }
        // 菜单打开时 WSAD 交给菜单导航（避免相机与列表导航抢键）
        if (t && (t.closest('.slide-menu') || t.closest('.menu-container'))) {
            return false;
        }
        return true;
    };
    const _freeflyKeyFlag = (code: string, down: boolean): boolean => {
        switch (code) {
            case 'KeyW':
                freeflyInput.forward = down;
                return true;
            case 'KeyS':
                freeflyInput.backward = down;
                return true;
            case 'KeyA':
                freeflyInput.left = down;
                return true;
            case 'KeyD':
                freeflyInput.right = down;
                return true;
            case 'KeyQ':
                freeflyInput.up = down;
                return true;
            case 'KeyE':
                freeflyInput.down = down;
                return true;
        }
        return false;
    };
    _reg(window, 'keydown', (e) => {
        if (!_freeflyKeyActive(e.target as HTMLElement)) {
            return;
        }
        if (_freeflyKeyFlag(e.code, true)) {
            e.preventDefault();
        }
    });

    // Freefly WASD release
    _reg(window, 'keyup', (e) => {
        // keyup 不受输入框/菜单守卫限制：保证松键总能清标记，避免相机“卡住”持续移动
        if ((getSceneAction('getCameraMode')?.() ?? 'orbit') !== 'freefly') {
            return;
        }
        if (_freeflyKeyFlag(e.code, false)) {
            e.preventDefault();
        }
    });

    // ======== orbit 模式 WSAD 平移（自由飞行式，与 freefly WSAD 统一相机键位） ========
    // W/S = 沿视线水平投影前后、A/D = 沿右轴左右、Q/E = 注视点升降；缩放走鼠标滚轮原生。
    // 丝滑：keydown/keyup 只置位，实际积分由 camera-behaviors.ts 的 initOrbitUpdate
    // 渲染循环逐帧推进（同 freefly）。方向键从相机控制让出：菜单开 = 导航，菜单关 = 播放 seek。
    const _orbitKeyActive = (t: HTMLElement | null): boolean => {
        if ((getSceneAction('getCameraMode')?.() ?? 'orbit') !== 'orbit') {
            return false;
        }
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
            return false;
        }
        // 菜单打开时 WSAD 交给菜单导航（避免相机与列表导航抢键）
        if (t && (t.closest('.slide-menu') || t.closest('.menu-container'))) {
            return false;
        }
        return true;
    };
    const _orbitKeyFlag = (code: string, down: boolean): boolean => {
        switch (code) {
            case 'KeyW':
                orbitInput.forward = down;
                return true;
            case 'KeyS':
                orbitInput.backward = down;
                return true;
            case 'KeyA':
                orbitInput.left = down;
                return true;
            case 'KeyD':
                orbitInput.right = down;
                return true;
            case 'KeyQ':
                orbitInput.up = down;
                return true;
            case 'KeyE':
                orbitInput.down = down;
                return true;
        }
        return false;
    };
    _reg(window, 'keydown', (e) => {
        if (!_orbitKeyActive(e.target as HTMLElement)) {
            return;
        }
        if (_orbitKeyFlag(e.code, true)) {
            e.preventDefault();
        }
    });
    _reg(window, 'keyup', (e) => {
        // keyup 不受菜单守卫限制：保证松键总能清标记，避免相机“卡住”持续旋转
        if ((getSceneAction('getCameraMode')?.() ?? 'orbit') !== 'orbit') {
            return;
        }
        if (_orbitKeyFlag(e.code, false)) {
            e.preventDefault();
        }
    });

    // Seek bar
    _reg(dom.seekBar, 'pointerdown', (e) => {
        setSeekDragging(true);
        seekWasPlaying = isPlaying;
        if (isPlaying && mmdRuntime) {
            mmdRuntime.pauseAnimation();
            setIsPlaying(false);
        }
        getSceneAction('seekFromEvent')?.(e);
        dom.seekBar.setPointerCapture(e.pointerId);
    });
    _reg(window, 'pointermove', (e) => {
        if (seekDragging) {
            getSceneAction('seekFromEvent')?.(e);
        }
    });
    _reg(window, 'pointerup', async () => {
        if (!seekDragging) {
            return;
        }
        setSeekDragging(false);
        if (seekWasPlaying && mmdRuntime && getSceneAction('focusedMmdModel')?.()) {
            await mmdRuntime.playAnimation();
            setIsPlaying(true);
            getSceneAction('updatePlaybackUI')?.();
        }
    });

    // ======== Click canvas to toggle overlays ========
    // ======== Canvas click to toggle overlays (single finger only) ========
    _reg(window, 'pointerdown', (e) => {
        _activePointerCount++;
        // 仅单指时做点按判定；多指交给相机缩放/平移
        if (_activePointerCount !== 1) {
            return;
        }
        _pointerDownPos = { x: e.clientX, y: e.clientY };
    });

    _reg(window, 'pointerup', (e) => {
        const wasMulti = _activePointerCount > 1;
        _activePointerCount = Math.max(0, _activePointerCount - 1);
        if (wasMulti) {
            return;
        }

        // 检查移动距离，避免拖拽时被误判为 click
        const dx = e.clientX - _pointerDownPos.x;
        const dy = e.clientY - _pointerDownPos.y;
        if (Math.sqrt(dx * dx + dy * dy) > 5) {
            return;
        }

        if (!dom.canvas.contains(e.target as Node)) {
            return;
        }

        // [doc:adr-238] 沉浸切换逻辑下沉 menus/nav-actions，经桥调用
        getUiAction('toggleOverlayMode')?.();
    });
}

// ======== Update Notification ========
export function showUpdateToast(latest: string, url: string, downloadUrl?: string): void {
    const toast = document.getElementById('updateToast');
    if (!toast) {
        return;
    }
    const fileEl = toast.querySelector<HTMLElement>('.toast-file');
    if (fileEl) {
        fileEl.textContent = t('main.versionAvailable', { version: latest });
    }
    const btn = toast.querySelector<HTMLButtonElement>('.toast-import-btn');
    if (btn) {
        // [doc:adr-179] Android + direct APK link → download & install
        const hasDirectInstall = !!downloadUrl && getCachedCapabilities().installApk;
        if (hasDirectInstall) {
            btn.textContent = t('settings.about.update.downloadInstall');
        }
        btn.onclick = async () => {
            if (!hasDirectInstall) {
                openExternalLink(url);
            } else {
                // Download APK and launch installer
                btn.disabled = true;
                btn.textContent = t('settings.about.update.downloading');
                try {
                    const result = await DownloadApk();
                    if (result && result.success && result.localPath) {
                        // [doc:adr-179] Register one-shot listener for install failures.
                        // WailsBridge emits 'update:installFailed' via evalJavascript when the
                        // system installer cannot be launched (e.g. FileProvider path error,
                        // missing REQUEST_INSTALL_PACKAGES permission rejected).
                        const onInstallFailed = () => {
                            btn.textContent = t('settings.about.update.downloadFailed');
                            openExternalLink(url);
                        };
                        window.addEventListener('update:installFailed', onInstallFailed);
                        window.wails?.installApk?.(result.localPath);
                        btn.textContent = t('settings.about.update.installLaunched');
                        // Clean up listener after a generous window (Java→JS bridge is async).
                        setTimeout(() => {
                            window.removeEventListener('update:installFailed', onInstallFailed);
                        }, 10000);
                    } else {
                        btn.textContent = t('settings.about.update.downloadFailed');
                        openExternalLink(url);
                    }
                } catch {
                    btn.textContent = t('settings.about.update.downloadFailed');
                    openExternalLink(url);
                } finally {
                    btn.disabled = false;
                }
            }
            // Only auto-hide for the simple "open URL" path.
            // Direct-install path keeps the toast visible for feedback;
            // the ignore button or next toast invocation will dismiss it.
            if (!hasDirectInstall) {
                toast.classList.remove('visible');
                toast.setAttribute('inert', '');
                toast.setAttribute('aria-hidden', 'true');
            }
        };
    }
    const ignoreBtn = toast.querySelector<HTMLButtonElement>('.toast-ignore-btn');
    if (ignoreBtn) {
        ignoreBtn.onclick = () => {
            toast.classList.remove('visible');
            toast.setAttribute('inert', '');
            toast.setAttribute('aria-hidden', 'true');
        };
    }
    toast.classList.add('visible');
    toast.removeAttribute('inert');
    toast.setAttribute('aria-hidden', 'false');
}

// ======== Drag & Drop Import ========
// handleDropFile / handleDroppedFile 抽至 ./drop-import（纯逻辑，便于单测）。
// 此处仅保留 DOM 事件注册 + overlay 视觉控制。
function hideDropOverlay(): void {
    document.getElementById('dropOverlay')!.classList.remove('visible');
}

export function initDropHandler(): void {
    let dragCounter = 0;
    let docDragOverCount = 0;
    let winDragOverCount = 0;
    let dragOverLogged = 0;
    console.info('[drop-diag] initDropHandler registered on window');
    // 同时在 document 和 window 上注册 dragover，对比哪个先收到 / 是否被拦截
    // [audit:round13 P2] 改用 _reg 收集，纳入 disposeEventHandlers 统一清理；
    // 原 document.addEventListener 裸注册在 HMR 重跑 init 时累积监听器 + 重复日志。
    _reg(
        document,
        'dragover',
        (e) => {
            docDragOverCount++;
            if (dragOverLogged < 2) {
                dragOverLogged++;
                console.info(
                    '[drop-diag] doc dragover #' + docDragOverCount,
                    'target:',
                    (e.target as HTMLElement)?.tagName,
                    'dropEffect:',
                    e.dataTransfer?.dropEffect,
                    'effectAllowed:',
                    e.dataTransfer?.effectAllowed,
                    'defaultPrevented:',
                    e.defaultPrevented
                );
            }
        },
        { capture: true }
    ); // capture 阶段，最早收到
    _reg(window, 'dragenter', (e) => {
        e.preventDefault();
        // 显式设置 dropEffect，避免浏览器默认 'none' 导致禁止图标
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'copy';
        }
        dragCounter++;
        const loading = document.getElementById('loading');
        console.info(
            '[drop-diag] dragenter',
            dragCounter,
            'target:',
            e.target?.tagName,
            'loading.display:',
            loading?.style.display,
            'loading.pe:',
            loading ? window.getComputedStyle(loading).pointerEvents : 'N/A',
            'dropEffect:',
            e.dataTransfer?.dropEffect
        );
        if (dragCounter === 1) {
            document.getElementById('dropOverlay')!.classList.add('visible');
        }
    });
    _reg(window, 'dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        console.info(
            '[drop-diag] dragleave',
            dragCounter,
            'docDragOver:',
            docDragOverCount,
            'winDragOver:',
            winDragOverCount
        );
        if (dragCounter <= 0) {
            dragCounter = 0;
            hideDropOverlay();
        }
    });
    _reg(window, 'dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'copy';
        }
        winDragOverCount++;
        if (winDragOverCount <= 2) {
            console.info(
                '[drop-diag] win dragover #' + winDragOverCount,
                'preventDefault+dropEffect=copy OK, target:',
                e.target?.tagName
            );
        }
    });
    _reg(window, 'drop', async (e) => {
        console.info(
            '[drop-diag] drop fired! files:',
            e.dataTransfer?.files?.length ?? 0,
            'docDragOver:',
            docDragOverCount,
            'winDragOver:',
            winDragOverCount
        );
        e.preventDefault();
        hideDropOverlay();
        if (!e.dataTransfer?.files) {
            console.warn('[drop-diag] no dataTransfer.files — drop intercepted by browser?');
            return;
        }
        for (const file of Array.from(e.dataTransfer.files) as File[]) {
            console.info('[drop-diag] handling file:', file.name, file.size, 'bytes');
            await handleDroppedFile(file);
        }
    });
}

// ======== Update Notification ========
