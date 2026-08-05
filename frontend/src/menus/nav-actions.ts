// nav-actions.ts — [doc:adr-238] 菜单导航动作层（从 core/events.ts + core/init.ts 下沉）。
// 职责：导航按钮映射（navActions/navLabels）、overlay 切换（toggleOverlay）、
// 画布点击沉浸切换（_toggleOverlays）、导航标签构建（buildNavMaps）、
// 导航按钮 DOM 接线（setupNavButtonBindings）。
// 全部为 UI 导航逻辑，归 menus 层；core（shortcut-app/events）经
// core/ui-action-bridge 的 navAction/navLabel 调用，不再 import menus。
import { dom, setPopupOpen } from '@/core/config';
import { addDisposableListener } from '@/core/dom';
import { getAllShortcuts, getAriaKeyshortcuts } from '@/core/shortcut-registry';
import { registerUiAction } from '@/core/ui-action-bridge';
import { closeAllOverlays, setOnCloseAllOverlays } from './menu-overlay';
import { showModelPopup, showMotionPopup } from './library';
import { showPlaza } from './plaza-browser';
import { closePlaza } from './plaza-state';
import { getOpenMenus } from './menu';
import { safeCallAsync } from '@/core/safe-call';

// ======== Module-level state ========
const _lastOverlayFn = new Map<string, () => void>();
// Register closeAllOverlays callback to reset toggleOverlay state.
setOnCloseAllOverlays(() => {
    _lastOverlayFn.clear();
});

export const navLabels: Record<number, string> = {};

// ======== Nav / overlay helpers ========
function syncNavAriaExpanded(): void {
    const overlay = document.getElementById('sceneOverlay');
    const activeType = overlay.classList.contains('visible') ? overlay.dataset.popupType : null;

    document.querySelectorAll<HTMLElement>('[aria-controls]').forEach((btn) => {
        const btnType = btn.dataset.popupType;
        btn.setAttribute('aria-expanded', btnType === activeType ? 'true' : 'false');
    });
}

function waitForTransition(el: HTMLElement, propertyName?: string): Promise<void> {
    return new Promise((resolve) => {
        const dur = parseFloat(getComputedStyle(el).transitionDuration) * 1000 || 0;
        if (dur <= 0) {
            resolve();
            return;
        }
        const disp = addDisposableListener(el, 'transitionend', (e) => {
            if (propertyName && (e as TransitionEvent).propertyName !== propertyName) {
                return;
            }
            disp.dispose();
            resolve();
        });
        const timeout = Math.max(dur * 2, 500); // D1: 安全网 ≥ 2× 时长且下限 500ms
        setTimeout(resolve, timeout);
    });
}

let _toggling = false; // [audit:P2] 并发锁：防快速点击导致 DOM 状态不一致
export async function toggleOverlay(id: string, showFn: () => void): Promise<void> {
    if (_toggling) {
        return;
    }
    _toggling = true;
    try {
        const el = document.getElementById(id);
        if (!el) {
            return;
        }
        const last = _lastOverlayFn.get(id);
        if (el.classList.contains('visible')) {
            if (last === showFn) {
                // Same button clicked again → toggle close
                el.classList.remove('visible');
                el.inert = true; // 关闭时从 Tab 顺序中移除
                setPopupOpen(false);
                syncNavAriaExpanded();
                _lastOverlayFn.delete(id);
            } else {
                // Different button targeting the same overlay → cross-fade switch
                el.classList.add('overlay-fade-out');
                await waitForTransition(el, 'opacity');
                el.classList.remove('overlay-fade-out', 'visible');
                closeAllOverlays();
                showFn();
                document.body.classList.remove('ui-hidden');
                el.classList.add('visible');
                el.removeAttribute('inert');
            }
        } else {
            closeAllOverlays();
            showFn();
            document.body.classList.remove('ui-hidden');
            el.classList.remove('overlay-fade-out'); // 防御：确保残留动画类不影响显示
            el.classList.add('visible');
            el.removeAttribute('inert'); // 打开时恢复 Tab 可达
        }
        if (el.classList.contains('visible')) {
            _lastOverlayFn.set(id, showFn);
        }
    } finally {
        _toggling = false;
    }
}

export const navActions: Record<number, () => void | Promise<void>> = {
    1: () => toggleOverlay('sceneOverlay', showModelPopup),
    2: () => toggleOverlay('sceneOverlay', showMotionPopup),
    3: async () => {
        const m = await import('./scene-menu');
        toggleOverlay('sceneOverlay', m.showSceneMenu);
    },
    4: async () => {
        const m = await import('./env-menu');
        toggleOverlay('sceneOverlay', m.showEnvMenu);
    },
    5: async () => {
        const m = await import('./settings');
        toggleOverlay('sceneOverlay', m.showSettings);
    },
    7: () => {
        const layer = document.getElementById('webviewLayer');
        if (layer && layer.classList.contains('visible')) {
            closePlaza();
        } else {
            toggleOverlay('webviewLayer', showPlaza);
        }
    },
    8: async () => {
        const m = await import('./assistant-panel');
        toggleOverlay('sceneOverlay', m.showAssistant);
    },
};

function _toggleOverlays(): void {
    // 画布点击：唯一职责是切换「无 UI / 沉浸」模式。
    document.body.classList.toggle('ui-hidden');
    syncNavAriaExpanded();
}

// ======== Build nav shortcut maps ========
export function buildNavMaps(): void {
    const shortcuts = getAllShortcuts();
    document.querySelectorAll<HTMLElement>('[data-shortcut]').forEach((el) => {
        const key = el.dataset.shortcut || '';
        const k = parseInt(key, 10);
        if (k >= 1 && k <= 9) {
            navLabels[k] = el.title || '';
        }
        // Sync badge text from data-shortcut
        const badge = el.querySelector<HTMLElement>('.shortcut-badge');
        if (badge) {
            badge.textContent = key;
        }
        // Sync data-hint shortcut suffix from data-shortcut
        const hint = el.getAttribute('data-hint');
        if (hint) {
            const clean = hint.replace(/\s*·\s*Ctrl\+\d+$/, '');
            el.setAttribute('data-hint', `${clean} · Ctrl+${key}`);
        }
        // ADR-153: aria-keyshortcuts for screen readers
        const shortcutId = `toggle:${el.dataset.popupType || ''}`;
        const def = shortcuts.find((s) => s.id === shortcutId);
        if (def) {
            el.setAttribute('aria-keyshortcuts', getAriaKeyshortcuts(def));
        }
    });
}

// ======== 导航按钮 DOM 接线（从 core/init.ts 下沉） ========
// [doc:e2e] 按钮监听器在 initScene 之前注册，确保纯 Vite 模式下 overlay 可打开；
// 即使 WASM 加载失败或场景初始化异常，用户仍能点击导航按钮查看菜单。
// 模块加载即接线（nav-actions 由 initLibrary 启动链加载）；HMR 幂等由
// _navDisposables 收集 + disposeNavBindings 清理（init 的 disposeEventHandlers 流程兜底）。
const _navDisposables: { dispose(): void }[] = [];

/** 安装导航按钮监听（幂等：已安装则跳过） */
function installNavBindings(): void {
    if (_navDisposables.length > 0) {
        return;
    }
    _navDisposables.push(
        addDisposableListener(dom.btnMainAction, 'click', () =>
            toggleOverlay('sceneOverlay', showModelPopup)
        ),
        addDisposableListener(dom.btnMotionPopup, 'click', () =>
            toggleOverlay('sceneOverlay', showMotionPopup)
        ),
        addDisposableListener(dom.btnScene, 'click', async () => {
            const m = await import('./scene-menu');
            toggleOverlay('sceneOverlay', m.showSceneMenu);
        }),
        addDisposableListener(dom.btnEnv, 'click', async () => {
            const m = await import('./env-menu');
            toggleOverlay('sceneOverlay', m.showEnvMenu);
        }),
        addDisposableListener(dom.btnSettings, 'click', async () => {
            const m = await import('./settings');
            await safeCallAsync('nav-actions', 'preloadAutoImportState', () =>
                m.preloadAutoImportState()
            ); // 静默失败，避免阻塞 UI
            await safeCallAsync('nav-actions', 'preloadDownloadWatchState', () =>
                m.preloadDownloadWatchState()
            ); // 预加载监听开关状态
            toggleOverlay('sceneOverlay', m.showSettings);
        }),
        addDisposableListener(dom.btnAssistant, 'click', async () => {
            const m = await import('./assistant-panel');
            toggleOverlay('sceneOverlay', m.showAssistant);
        }),
        addDisposableListener(dom.btnPlaza, 'click', () => {
            const layer = document.getElementById('webviewLayer');
            if (layer && layer.classList.contains('visible')) {
                closePlaza();
            } else {
                toggleOverlay('webviewLayer', showPlaza);
            }
        })
    );
}

/** 卸载导航按钮监听（HMR/dispose 用） */
export function disposeNavBindings(): void {
    for (const d of _navDisposables) {
        d.dispose();
    }
    _navDisposables.length = 0;
}

/** [doc:adr-238] nav-actions 启动入口：安装按钮接线 + 构建导航标签映射。
 *  模块加载即执行（nav-actions 经 main.ts side-effect import library-setup 链拉起，
 *  早于 initScene，满足 E2E「按钮监听器先于场景初始化注册」）。 */
export function initNavActions(): void {
    installNavBindings();
    buildNavMaps();
}

// [doc:adr-238] 模块加载即接线（幂等）
initNavActions();

// ======== Bridge registration ========
// [doc:adr-238] 注册导航行为供 core 快捷键/事件层经桥调用（切断 core→menus 反向边）
registerUiAction('navAction', (index: number) => {
    const fn = navActions[index];
    if (fn) {
        return fn();
    }
    return undefined;
});
registerUiAction('toggleOverlayMode', () => {
    _toggleOverlays();
});
registerUiAction('navLabel', (index: number) => getNavLabel(index));

/** [doc:adr-238] Android 返回键统一处理（从 core/init.ts 下沉）：
 *  优先 SlideMenu pop/close，其次关遮罩（plaza 专用清理），返回 true 表示已消费。
 *  返回 false 表示无菜单/遮罩可关，调用方执行二次返回退出。 */
function handleAndroidBack(): boolean {
    const openMenus = getOpenMenus().filter((m) => m.isVisible);
    if (openMenus.length > 0) {
        const top = openMenus[openMenus.length - 1]; // 最后创建 = 最顶层
        if (top.levelCount > 1) {
            top.pop();
        } else {
            top.close();
        }
        return true;
    }
    const anyOverlayOpen =
        document.querySelector('[data-overlay].visible') !== null ||
        document.querySelector('.mmd-dialog-visible') !== null;
    if (anyOverlayOpen) {
        // Plaza needs dedicated cleanup (stop proxy + release iframe);
        // closePlaza() internally calls closeAllOverlays().
        const plazaLayer = document.getElementById('webviewLayer');
        if (plazaLayer && plazaLayer.classList.contains('visible')) {
            closePlaza();
        } else {
            closeAllOverlays();
        }
        return true;
    }
    return false;
}
registerUiAction('handleAndroidBack', handleAndroidBack);

/** 供 core 侧读取导航标签（经桥，不直接 import menus） */
export function getNavLabel(index: number): string {
    return navLabels[index] || '';
}
