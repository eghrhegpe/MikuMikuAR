// [doc:architecture] Utility functions for MikuMikuAR.
// Extracted from config.ts — pure helpers, library refs, menu wrappers.
// Status bar → status-bar.ts
// Toast notifications → toast.ts
// UI builders → ui-helpers.ts

import { dom } from './dom';
import { libraryRoot, overridePaths, setPopupOpen } from './state';
import { normPath, getBaseName, getDirPath, isUnderRoot, isStageLike } from './path';
export { getBaseName, getDirPath, isUnderRoot, isStageLike, normPath };
import { setStatus } from './status-bar';
import { t } from './i18n/t';
import { translateGoError } from './i18n/goerr';
export { showErrorToast } from './toast';
export type { ToastAction } from './toast';
import { feedbackStatus, feedbackError, feedbackInfo } from './feedback';
import type { SlideMenu } from '../menus/menu';

import { logWarn, logError } from './logger';
// Re-export for external consumers (utils still serves as a barrel)
export { logWarn, logError };

export { formatTime, formatError } from './format';

// ======== Path Helpers ========

// ======== Card Container ========

/** Card container helper: removes render-card bg, wraps content in an lcard. Returns dispose from callback if provided. */
export function cardContainer(
    container: HTMLElement,
    fn: (c: HTMLElement) => (() => void) | void
): (() => void) | void {
    container.classList.remove('render-card');
    const card = document.createElement('div');
    card.className = 'lcard';
    const dispose = fn(card);
    container.appendChild(card);
    return dispose;
}

// ======== Loading Indicator ========

/**
 * 加载指示器包裹器：显示 loading 遮罩 → 执行 fn → `finally` 隐藏。
 * 收敛各加载器重复的 `loadingEl.display` 显隐 + `loadingText` 样板，
 * 避免"改一处漏一处"（ADR-096 复用收敛）。
 *
 * 注意：仅封装遮罩显隐与 `finally` 清理；**异常处理由 `fn` 内部自行负责**，
 * 以保留各加载器差异化的错误文案（`console.error` tag / `setStatus` key）
 * 与提前 `return` 语义。带进度回调的加载器（model-loader/props）不适用本包裹器。
 *
 * @param textKey loading 文案的 i18n key
 * @param fn 加载主体（自行 try/catch 差异化错误）
 */
export async function withLoadingIndicator<T>(textKey: string, fn: () => Promise<T>): Promise<T> {
    dom.loadingEl.style.display = 'block';
    dom.loadingText.textContent = t(textKey);
    try {
        return await fn();
    } finally {
        dom.loadingEl.style.display = 'none';
    }
}

// ======== Formatting ========

export { canvasToBase64, toBase64, thumbDataUrl } from './image';

export { generateUuid } from './uuid';

export { escapeHtml } from './escape-html';

// ======== Math Helpers ========

// [doc:adr-190-followup] 数学钳制收敛至零依赖叶子 clamp.ts，避免纯模块拖入整桶 @/core/utils
import { clamp, clampInt, clamp01, lerp, lerpArray, clampPct } from './clamp';
import {
    swallowError,
    fireAndForget,
    delay,
    waitForFrame,
    LoadingGuard,
    DebouncedTimer,
    Abortable,
} from './async';
export { clamp, clampInt, clamp01, lerp, lerpArray, clampPct };
export {
    swallowError,
    fireAndForget,
    delay,
    waitForFrame,
    LoadingGuard,
    DebouncedTimer,
    Abortable,
};

export { dist2d, dist3d, degToRad, radToDeg } from './math-geometry';
export { ensureArray, filterKeys, Cache, allSettledFilter } from './collections';

// ======== Object Helpers ========

/** 泛型键值写入工具，避免大量 `obj[key] = value` 重复。 */
// ======== Resource Path Resolution =========
export const stackRegistry: {
    modelStack: SlideMenu | null;
    sceneStackGetter: (() => SlideMenu | null) | null;
    buildLevel:
        | ((
              dir: string,
              label: string,
              filter?: (m: import('./types').LibraryModel) => boolean,
              targetStack?: SlideMenu,
              extraFolders?: { label: string; path: string }[],
              outcome?: import('./types').BrowseOutcome
          ) => import('./types').PopupLevel)
        | null;
} = {
    modelStack: null,
    sceneStackGetter: null,
    buildLevel: null,
};

export {
    computeLibraryRef,
    resolveLibraryRef,
    getBrowseDir,
    CATEGORY_DIR,
} from '../library/library-path';

export {
    closeAllOverlays,
    setOnCloseAllOverlays,
    getMenuWrapper,
    disposeMenuWrapper,
    clearAllMenuWrappers,
} from '../menus/menu-overlay';

// ======== Auto-save Trigger ========
// 注：防抖下沉到 scene-serialize.ts 的 _autoSaveDebounced（500ms）统一处理，
// 此处只做函数指针注册，不再叠加 setTimeout，避免 1500ms + 500ms = 2000ms 双层延迟。

let _triggerAutoSaveImpl: (() => void) | null = null;

export function setTriggerAutoSave(fn: () => void): void {
    _triggerAutoSaveImpl = fn;
}

export function triggerAutoSave(): void {
    _triggerAutoSaveImpl?.();
}

export { tryCatchStatus, withLoadingStatus, withLoadingStatusTargeted } from './status-helpers';

// ======== Pure Functions (ADR-101 P3) ========

export { jsonStringify, jsonParse } from './json-stringify';

