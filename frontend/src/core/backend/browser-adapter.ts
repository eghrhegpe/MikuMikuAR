// [doc:architecture] 浏览器后端适配器 — ADR-176 / ADR-177 Phase 2
//
// 实现 BackendService 的 106 个方法（Omit<GoApp, ④33> 全集）：
//   - ① 81 个真实实现：配置/UIState/场景/截图/缩略图/ExtractZip/缓存/标签/最近/预设走 IndexedDB + JSZip
//   - ② 8 个 Select*：触发 File System Access API（调用方需接入阶段改造以消费 handle）
//   - ③ 17 个原生独占：抛 NotSupportedError 显式降级（capabilities() 已如实反映）
// 整体以 as unknown as BackendService 收敛类型（kind / capabilities / readFileBytes 覆盖）。
// 资源配对：beforeunload 释放 IndexedDB 连接（ADR-176 P4）。
//
// [doc:adr-177] Phase 2 A4 补齐：
//   - _resolveIdbKey：主应用传绝对路径（D:/models/foo.pmx）→ 映射为 IndexedDB key（file:foo）
//   - _defaultConfig / _defaultUIState：补全完整默认值，避免首屏空字段守护风暴
//   - Delete*Preset：从 no-op 改为真实删除（idbDelete）
//   - SetEnvState：从 uistate/envState 双源改为 Config.env 单源（对齐主应用 restoreEnvState）

import JSZip from 'jszip';
import type {
    Config,
    UIState,
    EnvState,
    ModelEntry,
    ExtractResult,
    UpdateCheckResult,
    RenderPreset,
} from '@bindings/mikumikuar/internal/app/models';
import { NotSupportedError } from './types';
import type { BackendService, BackendCapabilities } from './types';
import { idbGet, idbSet, idbDelete, idbKeys, closeIDB } from './idb';

// —— 资源配对（P4）——
if (
    typeof window !== 'undefined' &&
    typeof (window as { addEventListener?: unknown }).addEventListener === 'function'
) {
    (window as { addEventListener: (t: string, fn: () => void) => void }).addEventListener('beforeunload', () =>
        closeIDB()
    );
}

function _cap(): BackendCapabilities {
    const fsAccess =
        typeof (window as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function' ||
        typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
    return {
        ar: false,
        externalApps: false,
        plazaWindow: false,
        fsAccess,
        watchDir: false,
        proxyServer: false,
        fileServer: false,
        systemDirOpen: false,
        storageMode: false,
        screenshotSave: true,
        cacheManage: true,
        configPersist: true,
        modelScan: fsAccess,
    };
}

function _defaultUIState(): UIState {
    // 对齐 createMockUIState（__tests__/mocks/binding-factories.ts）+ UIState 接口必填字段
    return {
        scale: 1.0,
        popupWidth: 280,
        accent: '#4a6cf7',
        fontFamily: 'system',
        animations: true,
        blurBg: true,
        performanceMode: 'balanced',
        screenshotFormat: 'png',
        screenshotQuality: 90,
        autoCameraEnabled: false,
        autoCameraBeatsPerSwitch: 4,
        autoUpdateEnabled: false,
    } as unknown as UIState;
}

function _defaultConfig(): Config {
    // 对齐 Config 接口（models.ts:36-128）+ createMockUIState 默认值
    // 字段名 config_version（非 version），避免 restoreEnvState/restoreUIState 字段名不匹配
    return {
        config_version: 1,
        ui_state: _defaultUIState(),
        resource_root: '',
        storage_mode: 'web',
        override_paths: {
            pmx: '',
            vmd: '',
            audio: '',
            stage: '',
            prop: '',
            environment: '',
            md_dress: '',
            setting: '',
        },
        blender_path: '',
        mmd_path: '',
        display_name_priority: 'name_jp',
        download_watch_dir: '',
        download_auto_import: false,
        favorites: [],
        render_presets: [],
        custom_software: [],
        tags: {},
        recent_models: [],
    } as unknown as Config;
}

/**
 * [doc:adr-177] 将主应用传入的绝对路径映射为 IndexedDB key。
 *
 * 主应用模型加载器传绝对路径（如 `D:/models/foo.pmx`），但 IndexedDB 的 models store
 * 用 `file:<name>` 键规约存储原档字节（web-loader/library.ts:saveModel 写入）。
 * 本函数做透明映射，使主应用 readFileBytes('D:/models/foo.pmx') 能命中 file:foo。
 *
 * 映射规则：
 * 1. 已是 IDB key 前缀（file:/entry:/recent 等）→ 原样返回
 * 2. 绝对路径 → 提取文件名 → 去扩展名 → `file:<name>`
 * 3. 兜底 → `file:<完整文件名（含扩展名）>`
 *
 * 注意：同名文件（不同目录）会冲突——这是 IndexedDB 扁平键的既有设计限制。
 */
function _resolveIdbKey(path: string): string {
    // 已是 IDB key 前缀
    if (/^(file|entry|recent):/.test(path) || path === 'recent') {
        return path;
    }
    // Android SAF URI 原样返回（browser-adapter 不支持，但避免误转换）
    if (path.startsWith('content://') || path.startsWith('web://')) {
        return path;
    }
    // 绝对路径 → 提取文件名（去扩展名）
    const baseName = path.split(/[/\\]/).pop() || path;
    const name = baseName.replace(/\.(pmx|zip|vmd|vpd|png|jpg|jpeg|bmp|tga|dds|tif|tiff|wav|mp3|ogg|flac)$/i, '');
    return `file:${name}`;
}

async function _listModels(): Promise<ModelEntry[]> {
    // 键规约（ADR-176 Phase 3，与 web-loader/library.ts 共享）：
    //   `entry:<name>` = 模型元数据；`file:<name>` = 原档字节；`recent` = 最近列表。
    // 仅列 entry: 前缀，避免把原档字节 / recent 数组误当 ModelEntry 返回。
    const keys = (await idbKeys('models')).filter((k) => k.startsWith('entry:'));
    const out: ModelEntry[] = [];
    for (const k of keys) {
        const m = await idbGet<ModelEntry>('models', k);
        if (m) out.push(m);
    }
    return out;
}

// —— File System Access 对话框（②）——
async function _pickFile(accept?: string): Promise<FileSystemFileHandle | null> {
    const picker = (window as { showOpenFilePicker?: (o?: unknown) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker;
    if (typeof picker !== 'function') return null;
    const handles = await picker(accept ? { types: [{ accept: { 'application/octet-stream': [accept] } }] } : undefined);
    return handles[0] ?? null;
}

export const browserAdapter: BackendService = {
    kind: 'browser',
    capabilities: _cap,

    // —— readFileBytes（替换原生 ReadFileBytes 大写）——
    // [doc:adr-177] 主应用传绝对路径，经 _resolveIdbKey 映射为 IndexedDB key（file:<name>）
    async readFileBytes(path: string): Promise<Uint8Array | null> {
        const key = _resolveIdbKey(path);
        const bytes = (await idbGet<Uint8Array>('models', key)) ?? null;
        if (bytes) return bytes;
        // 兜底：尝试完整文件名（含扩展名），覆盖 web-loader saveModel 未去扩展名的边界情况
        const baseName = path.split(/[/\\]/).pop() || path;
        if (baseName && baseName !== path) {
            return (await idbGet<Uint8Array>('models', `file:${baseName}`)) ?? null;
        }
        return null;
    },

    // ============ ① 核心真实实现 ============
    async GetConfig(): Promise<Config> {
        return (await idbGet<Config>('config', 'config')) ?? _defaultConfig();
    },
    async SetConfig(cfg: Partial<Config>): Promise<void> {
        const cur = (await idbGet<Config>('config', 'config')) ?? _defaultConfig();
        await idbSet('config', 'config', { ...cur, ...cfg });
    },
    async GetUIState(): Promise<UIState> {
        // [doc:adr-177] 优先从 Config.ui_state 读（对齐主应用 restoreUIState 路径），
        // 兜底从 uistate store 读（向后兼容），最后用 _defaultUIState
        const cfg = await this.GetConfig();
        if (cfg.ui_state) return cfg.ui_state;
        return (await idbGet<UIState>('uistate', 'state')) ?? _defaultUIState();
    },
    async SetUIState(s: Partial<UIState>): Promise<void> {
        // [doc:adr-177] 双写：Config.ui_state（主应用读）+ uistate store（向后兼容）
        const cfg = await this.GetConfig();
        const merged = { ...(cfg.ui_state ?? _defaultUIState()), ...s };
        await this.SetConfig({ ui_state: merged } as Partial<Config>);
        await idbSet('uistate', 'state', merged);
    },
    async SetEnvState(s: Partial<EnvState>): Promise<void> {
        // [doc:adr-177] 单源：写入 Config.env（对齐主应用 restoreEnvState 读取路径）
        // 旧实现写 uistate/envState，与主应用 cfg.env 读取路径不一致，导致浏览器侧保存的环境状态无法恢复
        const cfg = await this.GetConfig();
        const merged = { ...(cfg.env ?? {}), ...s } as EnvState;
        await this.SetConfig({ env: merged } as Partial<Config>);
    },
    async GetStorageMode(): Promise<string> {
        return 'web';
    },
    async SetStorageMode(_mode: string): Promise<void> {
        // 浏览器固定 web 模式
    },
    async GetSystemA11ySettings(): Promise<Record<string, unknown>> {
        return (await idbGet<Record<string, unknown>>('config', 'a11y')) ?? {};
    },
    async GetBuildInfo(): Promise<Record<string, string>> {
        return { version: 'web', commit: 'web', date: new Date().toISOString() };
    },
    async CheckForUpdate(): Promise<UpdateCheckResult> {
        return {
            available: false,
            currentVersion: 'web',
            latestVersion: 'web',
            notes: '',
            url: '',
        } as unknown as UpdateCheckResult;
    },
    async ExtractZip(buf: Uint8Array): Promise<ExtractResult> {
        const zip = await JSZip.loadAsync(buf);
        const files: Record<string, Uint8Array> = {};
        await Promise.all(
            Object.keys(zip.files).map(async (name) => {
                const f = zip.files[name];
                if (!f.dir) files[name] = new Uint8Array(await f.async('arraybuffer'));
            })
        );
        return { files, rootDir: '', entries: Object.keys(files) } as unknown as ExtractResult;
    },
    async SaveScreenshot(data: Uint8Array): Promise<void> {
        const blob = new Blob([data as BlobPart], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `screenshot-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
    },
    async SaveThumbnail(name: string, data: Uint8Array): Promise<void> {
        await idbSet('thumbnails', name, data);
    },
    async GetThumbnail(name: string): Promise<Uint8Array | null> {
        return (await idbGet<Uint8Array>('thumbnails', name)) ?? null;
    },
    async SaveLastScene(name: string, data: Uint8Array): Promise<void> {
        await idbSet('scenes', name, data);
    },
    async LoadLastScene(name: string): Promise<Uint8Array | null> {
        return (await idbGet<Uint8Array>('scenes', name)) ?? null;
    },
    async GetCacheStats(): Promise<{ count: number; size: number }> {
        const keys = await idbKeys('caches');
        return { count: keys.length, size: 0 };
    },
    async ClearAllCaches(): Promise<void> {
        for (const k of await idbKeys('caches')) await idbDelete('caches', k);
    },
    async CleanOrphanCache(): Promise<void> {
        for (const k of await idbKeys('caches')) {
            const v = await idbGet('caches', k);
            if (!v) await idbDelete('caches', k);
        }
    },
    async ClearExtractCache(): Promise<void> {
        for (const k of await idbKeys('caches')) {
            if (k.startsWith('extract:')) await idbDelete('caches', k);
        }
    },
    async ClearThumbnailCache(): Promise<void> {
        for (const k of await idbKeys('thumbnails')) await idbDelete('thumbnails', k);
    },
    async GetAllTags(): Promise<string[]> {
        return (await idbGet<string[]>('tags', 'all')) ?? [];
    },
    async AddTag(tag: string): Promise<void> {
        const all = (await idbGet<string[]>('tags', 'all')) ?? [];
        if (!all.includes(tag)) all.push(tag);
        await idbSet('tags', 'all', all);
    },
    async RemoveTag(tag: string): Promise<void> {
        const all = (await idbGet<string[]>('tags', 'all')) ?? [];
        await idbSet('tags', 'all', all.filter((t) => t !== tag));
    },
    async GetTagsByModel(model: string): Promise<string[]> {
        return (await idbGet<string[]>(`tags`, `model:${model}`)) ?? [];
    },
    async GetModelsByTag(tag: string): Promise<string[]> {
        return (await idbGet<string[]>(`tags`, `tag:${tag}`)) ?? [];
    },
    async GetRecentModels(): Promise<ModelEntry[]> {
        return (await idbGet<ModelEntry[]>('models', 'recent')) ?? [];
    },
    async AddRecentModel(m: ModelEntry): Promise<void> {
        const all = (await idbGet<ModelEntry[]>('models', 'recent')) ?? [];
        all.unshift(m);
        await idbSet('models', 'recent', all.slice(0, 20));
    },
    async GetLibraryIndex(): Promise<ModelEntry[]> {
        return _listModels();
    },
    async GetModelMetaBatch(): Promise<ModelEntry[]> {
        return _listModels();
    },
    async SaveModelPreset(name: string, data: Uint8Array): Promise<void> {
        await idbSet('presets', `model:${name}`, data);
    },
    async GetModelPresets(): Promise<string[]> {
        return (await idbKeys('presets')).filter((k) => k.startsWith('model:')).map((k) => k.slice(6));
    },
    async LoadModelPreset(name: string): Promise<Uint8Array | null> {
        return (await idbGet<Uint8Array>('presets', `model:${name}`)) ?? null;
    },
    async LoadModelPresetFromLib(name: string): Promise<Uint8Array | null> {
        return (await idbGet<Uint8Array>('presets', `model:${name}`)) ?? null;
    },
    async SaveModelPresetToLibAuto(name: string, data: Uint8Array): Promise<void> {
        await idbSet('presets', `model:${name}`, data);
    },
    async SaveRenderPreset(name: string, data: Uint8Array): Promise<void> {
        await idbSet('presets', `render:${name}`, data);
    },
    async GetRenderPresets(): Promise<RenderPreset[]> {
        const keys = (await idbKeys('presets')).filter((k) => k.startsWith('render:'));
        const out: RenderPreset[] = [];
        for (const k of keys) {
            const p = await idbGet<RenderPreset>('presets', k);
            if (p) out.push(p);
        }
        return out;
    },
    async SaveScenePreset(name: string, data: Uint8Array): Promise<void> {
        await idbSet('presets', `scene:${name}`, data);
    },
    async GetPresetScenes(): Promise<string[]> {
        return (await idbKeys('presets')).filter((k) => k.startsWith('scene:')).map((k) => k.slice(6));
    },
    async GetPresetScenesDir(): Promise<string> {
        return 'web://presets/scenes';
    },
    async SaveEnvPresetAuto(name: string, data: Uint8Array): Promise<void> {
        await idbSet('presets', `env:${name}`, data);
    },
    async LoadEnvPreset(name: string): Promise<Uint8Array | null> {
        return (await idbGet<Uint8Array>('presets', `env:${name}`)) ?? null;
    },
    async ListEnvPresets(): Promise<string[]> {
        return (await idbKeys('presets')).filter((k) => k.startsWith('env:')).map((k) => k.slice(4));
    },
    async FileExists(path: string): Promise<boolean> {
        // [doc:adr-177] 经 _resolveIdbKey 映射，对齐 readFileBytes 路径语义
        const key = _resolveIdbKey(path);
        if ((await idbGet('models', key)) !== undefined) return true;
        const baseName = path.split(/[/\\]/).pop() || path;
        if (baseName && baseName !== path) {
            return (await idbGet('models', `file:${baseName}`)) !== undefined;
        }
        return false;
    },
    async SetUIAccent(v: string): Promise<void> {
        await idbSet('config', 'ui.accent', v);
    },
    async SetUIAnimations(v: boolean): Promise<void> {
        await idbSet('config', 'ui.animations', v);
    },
    async SetUIAutoUpdate(v: boolean): Promise<void> {
        await idbSet('config', 'ui.autoUpdate', v);
    },
    async SetUIBlurBg(v: boolean): Promise<void> {
        await idbSet('config', 'ui.blurBg', v);
    },
    async SetUIFontFamily(v: string): Promise<void> {
        await idbSet('config', 'ui.fontFamily', v);
    },
    async SetUIPopupWidth(v: number): Promise<void> {
        await idbSet('config', 'ui.popupWidth', v);
    },
    async SetUIScale(v: number): Promise<void> {
        await idbSet('config', 'ui.scale', v);
    },
    async GetDownloadAutoImport(): Promise<boolean> {
        return (await idbGet<boolean>('config', 'dl.autoImport')) ?? false;
    },
    async SetDownloadAutoImport(v: boolean): Promise<void> {
        await idbSet('config', 'dl.autoImport', v);
    },
    async GetDownloadWatchEnabled(): Promise<boolean> {
        return (await idbGet<boolean>('config', 'dl.watchEnabled')) ?? false;
    },
    async SetDownloadWatchEnabled(v: boolean): Promise<void> {
        await idbSet('config', 'dl.watchEnabled', v);
    },
    async GetDownloadWatchStatus(): Promise<Record<string, unknown>> {
        return (await idbGet('config', 'dl.watchStatus')) ?? {};
    },
    async SetLastBrowseDir(dir: string): Promise<void> {
        await idbSet('config', 'lastBrowseDir', dir);
    },
    async GetLastBrowseDir(): Promise<string> {
        return (await idbGet<string>('config', 'lastBrowseDir')) ?? '';
    },
    async SetBlenderPath(p: string): Promise<void> {
        await idbSet('config', 'blenderPath', p);
    },
    async SetMMDPath(p: string): Promise<void> {
        await idbSet('config', 'mmdPath', p);
    },
    async SetOverridePath(p: string): Promise<void> {
        await idbSet('config', 'overridePath', p);
    },
    async SetPerformanceMode(v: boolean): Promise<void> {
        await idbSet('config', 'performanceMode', v);
    },
    async SetResourceRoot(p: string): Promise<void> {
        await idbSet('config', 'resourceRoot', p);
    },
    async SetDisplayNamePriority(v: string): Promise<void> {
        await idbSet('config', 'displayNamePriority', v);
    },
    async ReadTextFile(path: string): Promise<string | null> {
        // [doc:adr-177] 经 _resolveIdbKey 映射（场景存档 JSON / outfit JSON 等）
        const key = _resolveIdbKey(path);
        const bytes = await idbGet<Uint8Array>('models', key);
        if (bytes) return new TextDecoder().decode(bytes);
        // 兜底：尝试完整文件名
        const baseName = path.split(/[/\\]/).pop() || path;
        if (baseName && baseName !== path) {
            const alt = await idbGet<Uint8Array>('models', `file:${baseName}`);
            if (alt) return new TextDecoder().decode(alt);
        }
        return null;
    },
    async ImportLocalFile(): Promise<ModelEntry[]> {
        return _listModels();
    },
    async ImportZip(buf: Uint8Array): Promise<ModelEntry[]> {
        await this.ExtractZip(buf);
        return _listModels();
    },

    // —— PlazaGo* 系列（①，网页内 iframe 可控）——
    async PlazaGoBack(): Promise<void> {
        history.back();
    },
    async PlazaGoForward(): Promise<void> {
        history.forward();
    },
    async PlazaReload(): Promise<void> {
        location.reload();
    },
    async PlazaZoomIn(): Promise<void> {
        /* 缩放由广场内部处理，浏览器侧无全局 hook */
    },
    async PlazaZoomOut(): Promise<void> {
        /* 同上 */
    },
    async PlazaZoomReset(): Promise<void> {
        /* 同上 */
    },

    // ============ ① 其余默认实现（返回合理默认，浏览器降级） ============
    async BundleScene(): Promise<Uint8Array> {
        return new Uint8Array();
    },
    // [doc:adr-177] Delete*Preset 从 no-op 改为真实删除（idbDelete）
    async DeleteEnvPreset(name: string): Promise<void> {
        await idbDelete('presets', `env:${name}`);
    },
    async DeleteModelPreset(name: string): Promise<void> {
        await idbDelete('presets', `model:${name}`);
    },
    async DeletePresetScene(name: string): Promise<void> {
        await idbDelete('presets', `scene:${name}`);
    },
    async IsolateModelDir(): Promise<string> {
        return '';
    },
    async ListDirRecursive(): Promise<string[]> {
        return [];
    },
    async ListSubDirs(): Promise<string[]> {
        return [];
    },
    async LoadOutfitFile(): Promise<Uint8Array | null> {
        return null;
    },
    async LoadSceneFile(): Promise<Uint8Array | null> {
        return null;
    },
    async ScanModelDir(): Promise<ModelEntry[]> {
        return _listModels();
    },

    // ============ ② File System Access API 对话框替代 ============
    async SelectDir(): Promise<string> {
        const picker = (window as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
        if (typeof picker !== 'function') throw new NotSupportedError('SelectDir');
        await picker();
        return 'web://selected-dir';
    },
    async SelectImportFile(): Promise<string> {
        const h = await _pickFile();
        return h ? 'web://file' : '';
    },
    async SelectBundleSaveFile(): Promise<string> {
        const picker = (window as { showSaveFilePicker?: () => Promise<FileSystemFileHandle> }).showSaveFilePicker;
        if (typeof picker !== 'function') throw new NotSupportedError('SelectBundleSaveFile');
        await picker();
        return 'web://save';
    },
    async SelectExeFile(): Promise<string> {
        const h = await _pickFile('.exe');
        return h ? 'web://exe' : '';
    },
    async SelectPresetOpenFile(): Promise<string> {
        const h = await _pickFile();
        return h ? 'web://preset' : '';
    },
    async SelectPresetSaveFile(): Promise<string> {
        const picker = (window as { showSaveFilePicker?: () => Promise<FileSystemFileHandle> }).showSaveFilePicker;
        if (typeof picker !== 'function') throw new NotSupportedError('SelectPresetSaveFile');
        await picker();
        return 'web://preset-save';
    },
    async SelectRetargetFile(): Promise<string> {
        const h = await _pickFile();
        return h ? 'web://retarget' : '';
    },
    async SelectSceneOpenFile(): Promise<string> {
        const h = await _pickFile();
        return h ? 'web://scene' : '';
    },

    // ============ ③ 原生独占，显式降级 ============
    async AddCustomSoftware(): Promise<void> {
        throw new NotSupportedError('AddCustomSoftware');
    },
    async ClosePlazaWindow(): Promise<void> {
        throw new NotSupportedError('ClosePlazaWindow');
    },
    async DownloadFromPlaza(): Promise<void> {
        throw new NotSupportedError('DownloadFromPlaza');
    },
    async FetchPlazaConfig(): Promise<Uint8Array> {
        throw new NotSupportedError('FetchPlazaConfig');
    },
    async GetCachedPlazaConfig(): Promise<Uint8Array | null> {
        throw new NotSupportedError('GetCachedPlazaConfig');
    },
    async LaunchSoftware(): Promise<void> {
        throw new NotSupportedError('LaunchSoftware');
    },
    async NavigatePlazaWindow(): Promise<void> {
        throw new NotSupportedError('NavigatePlazaWindow');
    },
    async OpenCacheDir(): Promise<void> {
        throw new NotSupportedError('OpenCacheDir');
    },
    async OpenScreenshotDir(): Promise<void> {
        throw new NotSupportedError('OpenScreenshotDir');
    },
    async OpenWithSoftware(): Promise<void> {
        throw new NotSupportedError('OpenWithSoftware');
    },
    async RemoveCustomSoftware(): Promise<void> {
        throw new NotSupportedError('RemoveCustomSoftware');
    },
    async ScanSoftwareDir(): Promise<void> {
        throw new NotSupportedError('ScanSoftwareDir');
    },
    async SetDownloadWatchDir(): Promise<void> {
        throw new NotSupportedError('SetDownloadWatchDir');
    },
    async StartFileServer(): Promise<void> {
        throw new NotSupportedError('StartFileServer');
    },
    async StartProxy(): Promise<void> {
        throw new NotSupportedError('StartProxy');
    },
    async StopProxy(): Promise<void> {
        throw new NotSupportedError('StopProxy');
    },
    async UpdateCustomSoftware(): Promise<void> {
        throw new NotSupportedError('UpdateCustomSoftware');
    },
} as unknown as BackendService;
