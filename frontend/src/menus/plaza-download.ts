// plaza-download.ts — 模型广场：下载监听 + 事件 + 快捷键
// 从 plaza.ts 拆分

import { events } from '../core/runtime-bridge';
import { setStatus } from '../core/status-bar';
import { t } from '../core/i18n/t';
import { translateGoError } from '../core/i18n/goerr';
import { showErrorToast } from '../core/toast';
import { refreshLibrary } from './library';
import { registerShortcuts } from '../core/shortcut-registry';
import { swallowError } from '../core/utils';
import { safeCallAsync } from '../core/safe-call';
import {
    PlazaGoBack,
    PlazaGoForward,
    PlazaReload,
    PlazaZoomIn,
    PlazaZoomOut,
    ClosePlazaWindow,
    DownloadFromPlaza,
} from '../core/wails-bindings';
import {
    downloadListenerInstalled,
    setDownloadListenerInstalled,
    eventListenersInstalled,
    setEventListenersInstalled,
    shortcutsRegistered,
    setShortcutsRegistered,
    plazaIframe,
    remoteURLDisplay,
    remoteProgress,
    observer,
    setObserver,
    getLayer,
    stopProxy,
} from './plaza-state';

// ======== 下载监听 ========

export function installDownloadListener(): void {
    if (downloadListenerInstalled) {
        return;
    }
    setDownloadListenerInstalled(true);
    window.addEventListener('message', (e: MessageEvent) => {
        if (e.data?.type !== 'plaza-download-request') {
            return;
        }
        if (!plazaIframe || e.source !== plazaIframe.contentWindow) {
            return;
        }
        const { url, filename } = e.data as { url: string; filename: string };
        if (!url) {
            return;
        }
        handlePlazaDownload(url, filename || 'download');
    });
}

export async function handlePlazaDownload(
    url: string,
    filename: string,
    signal?: AbortSignal
): Promise<void> {
    let abortCtrl: AbortController | undefined;
    let effectiveSignal: AbortSignal;
    if (signal) {
        effectiveSignal = signal;
    } else {
        abortCtrl = new AbortController();
        effectiveSignal = abortCtrl.signal;
    }

    setStatus(t('plaza.downloading', { name: filename }), false, true);
    try {
        if (effectiveSignal.aborted) {
            return;
        }
        if (typeof DownloadFromPlaza !== 'function') {
            throw new Error('binding not available');
        }
        const result = await DownloadFromPlaza(url, filename);
        if (effectiveSignal.aborted) {
            return;
        }
        setStatus(
            t('plaza.downloaded', { name: result.fileName, size: (result.size / 1024).toFixed(1) }),
            true
        );
    } catch (e) {
        setStatus(t('plaza.downloadFail', { err: translateGoError(e) }), true);
    } finally {
        abortCtrl?.abort();
    }
}

// ======== 快捷键 ========

export function installShortcuts(): void {
    if (shortcutsRegistered) {
        return;
    }
    setShortcutsRegistered(true);

    const visibleGuard = (fn: () => Promise<unknown> | void) => () => {
        const l = getLayer();
        if (l && l.classList.contains('visible')) {
            const r = fn();
            if (r) {
                swallowError(r);
            }
        }
    };

    const PLAZA_SHORTCUTS: Array<{
        id: string;
        key: string;
        ctrl?: boolean;
        alt?: boolean;
        handler: () => void;
    }> = [
        { id: 'plaza:reload', key: 'F5', handler: PlazaReload },
        { id: 'plaza:reload-ctrl', key: 'KeyR', ctrl: true, handler: PlazaReload },
        { id: 'plaza:goBack', key: 'ArrowLeft', alt: true, handler: PlazaGoBack },
        { id: 'plaza:goForward', key: 'ArrowRight', alt: true, handler: PlazaGoForward },
        { id: 'plaza:zoomIn', key: 'Equal', ctrl: true, handler: PlazaZoomIn },
        { id: 'plaza:zoomOut', key: 'Minus', ctrl: true, handler: PlazaZoomOut },
        { id: 'plaza:closeWindow', key: 'KeyW', ctrl: true, handler: ClosePlazaWindow },
    ];

    registerShortcuts(
        PLAZA_SHORTCUTS.map((s) => ({
            id: s.id,
            label: 'shortcuts.label.plaza' as const,
            group: 'shortcuts.group.plaza' as const,
            defaultKey: s.key,
            defaultCtrl: s.ctrl ?? false,
            defaultAlt: s.alt ?? false,
            prevent: true,
            handler: visibleGuard(s.handler),
        }))
    );
}

// ======== 事件监听 ========

export function installEventListeners(): void {
    if (eventListenersInstalled) {
        return;
    }
    setEventListenersInstalled(true);
    events.on('plaza:urlChanged', (data) => {
        const d = data as unknown as { url: string; title: string };
        if (remoteURLDisplay) {
            remoteURLDisplay.textContent = d.title || d.url || t('plaza.loading');
        }
    });
    events.on('plaza:downloadProgress', (data) => {
        const d = data as unknown as {
            fileName: string;
            read: number;
            total: number;
            percent: number;
        };
        if (remoteProgress) {
            const percent =
                d.percent > 0 ? `${d.percent.toFixed(0)}%` : `${(d.read / 1024).toFixed(0)} KB`;
            remoteProgress.textContent =
                t('plaza.downloading', { name: d.fileName }) + `: ${percent}`;
        }
    });
    events.on('plaza:downloadComplete', (data) => {
        const d = data as unknown as { fileName: string; size: number };
        if (remoteProgress) {
            remoteProgress.textContent = t('plaza.downloaded', {
                name: d.fileName,
                size: (d.size / 1024).toFixed(1),
            });
        }
        setTimeout(() => {
            if (remoteProgress) {
                remoteProgress.textContent = '';
            }
        }, 3000);
        showErrorToast(
            t('plaza.downloaded', { name: d.fileName, size: (d.size / 1024).toFixed(1) }),
            undefined,
            [
                {
                    label: t('plaza.viewLibrary'),
                    onClick: () =>
                        safeCallAsync('plaza', 'refresh after plaza download', () =>
                            refreshLibrary()
                        ),
                },
            ],
            8000
        );
    });
}

// ======== Observer ========

export function ensureObserver(): void {
    if (observer) {
        return;
    }
    const el = getLayer();
    if (!el) {
        return;
    }
    const obs = new MutationObserver(() => {
        if (!el.classList.contains('visible')) {
            stopProxy();
        }
    });
    setObserver(obs);
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
}
