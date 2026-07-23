// [doc:architecture] BackendService 适配器接口契约 — ADR-176
//
// 设计要点（2026-07-23 实测）：
// - 业务真实调用 Go 绑定 106 个（占契约测试 139 全量的 76%）。
// - `BackendService` 接口 = Go 生成类型 `typeof import('@bindings/.../app')`
//   排除 ④ 组 33 个零业务调用函数（ADR-176「调用集实证」）后的全集 + 自含的
//   `kind` / `capabilities()` / `readFileBytes`（base64 解码版，替换原生大写 ReadFileBytes）。
// - 复用 Go 生成类型，不手改生成物；browser-adapter 据此实现 106 方法。

import type * as GoAppNS from '@bindings/mikumikuar/internal/app/app';

/** Go 生成绑定的值类型（函数签名源）。 */
export type GoApp = typeof GoAppNS;

/**
 * 三态能力矩阵键（对齐 ADR-176「能力矩阵（三态 × 能力键）」节）。
 * capabilities() 如实反映，UI 屏蔽规则据此生成，避免「幽灵入口」。
 */
export interface BackendCapabilities {
    ar: boolean; // AR（ARCore/Vuforia）—— 原生独占
    externalApps: boolean; // 外部程序（Blender/MMD/LaunchSoftware）
    plazaWindow: boolean; // 模型广场窗口控制（Navigate/Close/Fetch/Download）
    fsAccess: boolean; // File System Access API（showDirectoryPicker 等）
    watchDir: boolean; // 目录监听（StartWatchDir/StopWatchDir）
    proxyServer: boolean; // 代理（StartProxy/StopProxy）
    fileServer: boolean; // 静态文件服务（StartFileServer/StopFileServer）
    systemDirOpen: boolean; // 系统文件管理器打开（OpenCacheDir/OpenScreenshotDir）
    storageMode: boolean; // 存储模式切换（GetStorageMode/SetStorageMode 有意义）
    screenshotSave: boolean; // 截图保存（Canvas.toBlob + download）
    cacheManage: boolean; // 缓存清理（IndexedDB）
    configPersist: boolean; // 配置持久化（IndexedDB）
    modelScan: boolean; // 模型库扫描（FSA 授权目录替代）
}

// ④ 零业务调用函数（ADR-176 实证章节清单）—— 从 BackendService 接口排除。
// 用 Extract<keyof GoApp, ...> 确保仅取 GoApp 实际存在的键，拼写偏差自动忽略。
type _ExcludedCandidate =
    | 'DeleteRenderPreset'
    | 'GetAppVersion'
    | 'GetModelMeta'
    | 'GetPath'
    | 'GetThumbnailBatch'
    | 'ListDir'
    | 'OpenInBlender'
    | 'OpenInMMD'
    | 'ReadFileBytes' // 由小写 readFileBytes（base64 解码版）替代
    | 'RenameModelPreset'
    | 'SaveEnvPreset'
    | 'SaveModelPresetToLib'
    | 'SaveSceneFile'
    | 'SelectAudioFile'
    | 'SelectEnvTextureFile'
    | 'SelectPMXFile'
    | 'SelectVMDMotion'
    | 'SelectVPDPose'
    | 'SetWailsApp'
    | 'StartWatchDir'
    | 'StopFileServer'
    | 'StopWatchDir'
    | 'ToggleFavorite'
    | 'DeleteMotionPreset'
    | 'GetMotionPresets'
    | 'LoadMotionPreset'
    | 'LoadMotionPresetFromLib'
    | 'RenameMotionPreset'
    | 'SaveMotionPreset'
    | 'SaveMotionPresetToLib'
    | 'SaveMotionPresetToLibAuto'
    | 'SelectMotionPresetOpenFile'
    | 'SelectMotionPresetSaveFile';
type ExcludedFromBackend = Extract<keyof GoApp, _ExcludedCandidate>;

/**
 * 统一后端抽象。go-adapter 透传 Go 全量（含契约测试 139 函数），
 * browser-adapter 实现 106（81 真实 + 8 FSA + 17 降级）。
 */
export type BackendService = Omit<GoApp, ExcludedFromBackend> & {
    readonly kind: 'go' | 'browser';
    capabilities(): BackendCapabilities;
    /** Wails v3 base64 透明解码版（替换原生 ReadFileBytes 大写）。 */
    readFileBytes(path: string): Promise<Uint8Array | null>;
};

/** 浏览器侧原生独占能力的统一错误。调用方据 capabilities() 预判或 catch 此错误。 */
export class NotSupportedError extends Error {
    constructor(what: string) {
        super(`[backend] ${what} 在浏览器环境下不可用（原生独占能力，已按 ADR-176 显式降级）`);
        this.name = 'NotSupportedError';
    }
}
