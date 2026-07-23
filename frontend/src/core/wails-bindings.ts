// wails-bindings.ts — Wails 生成绑定的手维护聚合层（ADR-176 Phase 2：backend 代理化）
//
// 架构（绞杀者模式）：
// - 本文件是业务层唯一后端入口（43 消费文件），Phase 2 起 106 个业务真实调用
//   函数改为经 `resolveBackend()` 路由的显式代理导出——桌面/安卓走 go-adapter，
//   浏览器走 browser-adapter（IndexedDB/FSA/显式降级），业务代码零改动完成切换。
// - ESM 规则：本地具名导出优先于 `export *`，故第一行星号透传仅兜底
//   ④ 组 33 个零业务调用函数（契约测试 139 全量不受扰动）。
// - go-adapter 直连 @bindings（不经本文件），无循环依赖。
// - ❌ 禁止在此新增绕过 resolveBackend 的直连导出（Android 冷启动竞态，见 ADR-176）。

export * from '@bindings/mikumikuar/internal/app/app';
export { Events } from '@wailsio/runtime';
export type {
    Config,
    EnvPresetEntry,
    EnvState,
    ExtractResult,
    FileInfo,
    ModelEntry,
    ModelMeta,
    ModelPresetEntry,
    RenderPreset,
    SoftwareEntry,
    UIState,
    UpdateCheckResult,
} from '@bindings/mikumikuar/internal/app/models';

import { resolveBackend } from './backend';
import type { BackendService } from './backend/types';

// ======== backend 代理工厂 ========
// 每次调用先 await resolveBackend()（惰性单例，首次含桥接注入等待），
// 再转发到选定 adapter。绑定函数本身全部返回 Promise，包装透明。
function _p<K extends keyof BackendService>(name: K): BackendService[K] {
    return (async (...args: unknown[]) => {
        const b = await resolveBackend();
        return (b[name] as unknown as (...a: unknown[]) => unknown)(...args);
    }) as BackendService[K];
}

/** 读取文件为 Uint8Array（go：自动解码 Wails v3 base64；browser：IndexedDB/FSA 直读）。 */
export async function readFileBytes(path: string): Promise<Uint8Array | null> {
    return (await resolveBackend()).readFileBytes(path);
}

// ======== 106 个业务真实调用函数的代理导出（ADR-176 调用集实证 ①+②+③ 组） ========
// 本地导出覆盖上方 `export *` 的同名符号（ESM 优先级规则）。
export const AddCustomSoftware = _p('AddCustomSoftware');
export const AddRecentModel = _p('AddRecentModel');
export const AddTag = _p('AddTag');
export const BundleScene = _p('BundleScene');
export const CheckForUpdate = _p('CheckForUpdate');
export const CleanOrphanCache = _p('CleanOrphanCache');
export const ClearAllCaches = _p('ClearAllCaches');
export const ClearExtractCache = _p('ClearExtractCache');
export const ClearThumbnailCache = _p('ClearThumbnailCache');
export const ClosePlazaWindow = _p('ClosePlazaWindow');
export const DeleteEnvPreset = _p('DeleteEnvPreset');
export const DeleteModelPreset = _p('DeleteModelPreset');
export const DeletePresetScene = _p('DeletePresetScene');
export const DownloadFromPlaza = _p('DownloadFromPlaza');
export const ExtractZip = _p('ExtractZip');
export const FetchPlazaConfig = _p('FetchPlazaConfig');
export const FileExists = _p('FileExists');
export const GetAllTags = _p('GetAllTags');
export const GetBuildInfo = _p('GetBuildInfo');
export const GetCacheStats = _p('GetCacheStats');
export const GetCachedPlazaConfig = _p('GetCachedPlazaConfig');
export const GetConfig = _p('GetConfig');
export const GetDownloadAutoImport = _p('GetDownloadAutoImport');
export const GetDownloadWatchEnabled = _p('GetDownloadWatchEnabled');
export const GetDownloadWatchStatus = _p('GetDownloadWatchStatus');
export const GetLastBrowseDir = _p('GetLastBrowseDir');
export const GetLibraryIndex = _p('GetLibraryIndex');
export const GetModelMetaBatch = _p('GetModelMetaBatch');
export const GetModelPresets = _p('GetModelPresets');
export const GetModelsByTag = _p('GetModelsByTag');
export const GetPresetScenes = _p('GetPresetScenes');
export const GetPresetScenesDir = _p('GetPresetScenesDir');
export const GetRecentModels = _p('GetRecentModels');
export const GetRenderPresets = _p('GetRenderPresets');
export const GetStorageMode = _p('GetStorageMode');
export const GetSystemA11ySettings = _p('GetSystemA11ySettings');
export const GetTagsByModel = _p('GetTagsByModel');
export const GetThumbnail = _p('GetThumbnail');
export const ImportLocalFile = _p('ImportLocalFile');
export const ImportZip = _p('ImportZip');
export const IsolateModelDir = _p('IsolateModelDir');
export const LaunchSoftware = _p('LaunchSoftware');
export const ListDirRecursive = _p('ListDirRecursive');
export const ListEnvPresets = _p('ListEnvPresets');
export const ListSubDirs = _p('ListSubDirs');
export const LoadEnvPreset = _p('LoadEnvPreset');
export const LoadLastScene = _p('LoadLastScene');
export const LoadModelPreset = _p('LoadModelPreset');
export const LoadModelPresetFromLib = _p('LoadModelPresetFromLib');
export const LoadOutfitFile = _p('LoadOutfitFile');
export const LoadSceneFile = _p('LoadSceneFile');
export const NavigatePlazaWindow = _p('NavigatePlazaWindow');
export const OpenCacheDir = _p('OpenCacheDir');
export const OpenScreenshotDir = _p('OpenScreenshotDir');
export const OpenWithSoftware = _p('OpenWithSoftware');
export const PlazaGoBack = _p('PlazaGoBack');
export const PlazaGoForward = _p('PlazaGoForward');
export const PlazaReload = _p('PlazaReload');
export const PlazaZoomIn = _p('PlazaZoomIn');
export const PlazaZoomOut = _p('PlazaZoomOut');
export const PlazaZoomReset = _p('PlazaZoomReset');
export const ReadTextFile = _p('ReadTextFile');
export const RemoveCustomSoftware = _p('RemoveCustomSoftware');
export const RemoveTag = _p('RemoveTag');
export const SaveEnvPresetAuto = _p('SaveEnvPresetAuto');
export const SaveLastScene = _p('SaveLastScene');
export const SaveModelPreset = _p('SaveModelPreset');
export const SaveModelPresetToLibAuto = _p('SaveModelPresetToLibAuto');
export const SaveRenderPreset = _p('SaveRenderPreset');
export const SaveScenePreset = _p('SaveScenePreset');
export const SaveScreenshot = _p('SaveScreenshot');
export const SaveThumbnail = _p('SaveThumbnail');
export const ScanModelDir = _p('ScanModelDir');
export const ScanSoftwareDir = _p('ScanSoftwareDir');
export const SelectBundleSaveFile = _p('SelectBundleSaveFile');
export const SelectDir = _p('SelectDir');
export const SelectExeFile = _p('SelectExeFile');
export const SelectImportFile = _p('SelectImportFile');
export const SelectPresetOpenFile = _p('SelectPresetOpenFile');
export const SelectPresetSaveFile = _p('SelectPresetSaveFile');
export const SelectRetargetFile = _p('SelectRetargetFile');
export const SelectSceneOpenFile = _p('SelectSceneOpenFile');
export const SetBlenderPath = _p('SetBlenderPath');
export const SetDisplayNamePriority = _p('SetDisplayNamePriority');
export const SetDownloadAutoImport = _p('SetDownloadAutoImport');
export const SetDownloadWatchDir = _p('SetDownloadWatchDir');
export const SetDownloadWatchEnabled = _p('SetDownloadWatchEnabled');
export const SetEnvState = _p('SetEnvState');
export const SetLastBrowseDir = _p('SetLastBrowseDir');
export const SetMMDPath = _p('SetMMDPath');
export const SetOverridePath = _p('SetOverridePath');
export const SetPerformanceMode = _p('SetPerformanceMode');
export const SetResourceRoot = _p('SetResourceRoot');
export const SetStorageMode = _p('SetStorageMode');
export const SetUIAccent = _p('SetUIAccent');
export const SetUIAnimations = _p('SetUIAnimations');
export const SetUIAutoUpdate = _p('SetUIAutoUpdate');
export const SetUIBlurBg = _p('SetUIBlurBg');
export const SetUIFontFamily = _p('SetUIFontFamily');
export const SetUIPopupWidth = _p('SetUIPopupWidth');
export const SetUIScale = _p('SetUIScale');
export const SetUIState = _p('SetUIState');
export const StartFileServer = _p('StartFileServer');
export const StartProxy = _p('StartProxy');
export const StopProxy = _p('StopProxy');
export const UpdateCustomSoftware = _p('UpdateCustomSoftware');
