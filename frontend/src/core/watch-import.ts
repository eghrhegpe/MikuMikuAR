// [doc:adr-102] Watch import notification — split from events.ts (P3).
// 处理文件监控发现新文件后的自动/手动导入逻辑。
import { setStatus, formatError } from './config';
import { t } from './i18n/t';
import { ImportLocalFile } from './wails-bindings';
import { events } from './runtime-bridge';
import { refreshLibrary } from '../menus/library';
import { getAutoImportCached } from '../menus/settings-shared';
import { DebouncedTimer } from './utils';
import { safeCallAsync } from './safe-call';

// ======== Download Watch Notification ========
const importToastTimer = new DebouncedTimer();

export async function importToLibrary(path: string, displayName: string): Promise<void> {
    setStatus(t('main.importing') + ': ' + displayName, false);
    try {
        await ImportLocalFile(path);
        setStatus(t('main.imported', { name: displayName }), true);
        safeCallAsync('watch-import', 'refresh after import', () => refreshLibrary());
    } catch (err: unknown) {
        setStatus(t('main.importFailed') + ': ' + formatError(err), false);
        console.error('[watch] import failed:', err);
    }
}

events.on('watch:newfile', (ev: unknown) => {
    // Wails 事件对象：data 字段承载 Go 端 EventsEmit 的 payload
    const payload = (ev as { data?: { path: string; name: string; type: string } } | null)
        ?.data ?? {
        path: '',
        name: '',
        type: '',
    };
    const displayName = payload.name || payload.path;

    // 自动导入模式：跳过 toast，直接入库（不加载到场景）
    if (getAutoImportCached()) {
        void importToLibrary(payload.path, displayName);
        return;
    }

    // 手动导入模式：显示 toast，用户点击导入按钮触发入库
    importToastTimer.cancel();
    const toast = document.getElementById('importToast');
    if (!toast) {
        return;
    }
    const nameEl = toast.querySelector('.toast-file');
    if (nameEl) {
        nameEl.textContent = displayName;
    }
    toast.classList.add('visible');
    toast.removeAttribute('inert');
    toast.setAttribute('aria-hidden', 'false');

    const importBtn = toast.querySelector('.toast-import-btn') as HTMLButtonElement | null;
    if (importBtn) {
        importBtn.onclick = async () => {
            importBtn.disabled = true;
            importBtn.textContent = t('main.importing');
            toast.classList.remove('visible');
            toast.setAttribute('inert', '');
            toast.setAttribute('aria-hidden', 'true');
            await importToLibrary(payload.path, displayName);
            importBtn.disabled = false;
            importBtn.textContent = t('main.importImport');
        };
    }

    const ignoreBtn = toast.querySelector('.toast-ignore-btn') as HTMLButtonElement | null;
    if (ignoreBtn) {
        ignoreBtn.onclick = () => {
            toast.classList.remove('visible');
            toast.setAttribute('inert', '');
            toast.setAttribute('aria-hidden', 'true');
        };
    }

    // Auto-hide after 10 seconds
    importToastTimer.schedule(() => {
        toast.classList.remove('visible');
        toast.setAttribute('inert', '');
        toast.setAttribute('aria-hidden', 'true');
    }, 10000);
});
