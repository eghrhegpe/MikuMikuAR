// [doc:architecture] BackendService 适配器接口契约 — ADR-176
//
// 设计要点（2026-07-23 实测）：
// - 业务真实调用 Go 绑定 106 个（占契约测试 139 全量的 76%）。
// - `BackendService` 接口 = Go 生成类型 `typeof import('@bindings/.../app')`
//   排除 ④ 组 33 个零业务调用函数（ADR-176「调用集实证」）后的全集 + 自含的
//   `kind` / `capabilities()` / `readFileBytes`（base64 解码版，替换原生大写 ReadFileBytes）。
// - 复用 Go 生成类型，不手改生成物；browser-adapter 据此实现 106 方法。

import type * as GoAppNS from '@bindings/mikumikuar/internal/app/app';
import type { Config } from '@bindings/mikumikuar/internal/app/models';

/** Go 生成绑定的值类型（函数签名源）。 */
export type GoApp = typeof GoAppNS;

/**
 * 三态能力矩阵键（对齐 ADR-176「能力矩阵（三态 × 能力键）」节）。
 * capabilities() 如实反映，UI 屏蔽规则据此生成，避免「幽灵入口」。
 */
export interface BackendCapabilities {
    // [doc:adr-178] ar = AR 相机透视（getUserMedia camera passthrough），桌面/安卓可用；
    //   与 arScope（原生 AR 路由）是**两个正交轴**，勿混淆（详见 adr-178）。
    ar: boolean;
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
    // —— 宿主级运行时能力键（ADR-178，补完四端 2×2 矩阵）——
    crossOriginIsolated: boolean; // SharedArrayBuffer 可用 → 多线程 MPR 物理（ADR-133）；安卓应用 WebView 恒 false
    clipboardReliable: boolean; // 剪贴板 API 可靠（手势/无限制）；安卓应用 WebView 部分版本 false（A2-06 根因）
    arScope: 'none' | 'android-app' | 'webxr'; // 原生 AR 路由作用域（与 ar 透视分离）：none=无 / android-app=ARCore / webxr=WebXR
    // [doc:adr-189] GPU 压缩纹理能力（运行时探测，非后端能力）
    ktx2Supported: boolean; // GPU 支持 KTX2 压缩纹理（ASTC/BC7/ETC2 任一）
    ktx2PreferredFormat: 'astc' | 'bc7' | 'etc2' | null; // 推荐转码目标格式；null 表示不支持
    // —— 安装/更新能力键（ADR-190：声明式收口，淘汰散落 isAndroidPlatform() 分支）——
    installApk: boolean; // 可直接安装 APK（安卓原生下载后拉起安装器）
    installLocal: boolean; // 有本地安装器路径（桌面/安卓可直装，网页跳转外链）
    inAppBrowser: boolean; // 可内嵌窗口/独立窗口浏览广场（桌面 Wails 原生窗口；网页/安卓走系统浏览器）
    fsSelectDir: boolean; // 能原生或 FSA 选择目录（桌面原生对话框 + 网页 FSA；安卓 WebView 不可）
    localStaging: boolean; // 桌面级暂存目录可用（_desktopStagingPath 写盘；网页走 IndexedDB 路径）
    androidStorageMode: boolean; // 安卓专属存储模式切换（private/shared 作用域）
}

// ④ 零业务调用函数（ADR-176 实证章节清单）—— 从 BackendService 接口排除。
// [doc:adr-277] 由「纯类型联合」降级为运行期常量：类型仍从它派生（单一事实源不变），
// 但测试可以据此逐键核对 browser-adapter 是否真的实现了每个契约方法 —— 双重断言时代
// 有 8 个 AI 方法根本没实现也被掩盖（见 browser-adapter.contract.test.ts）。
export const EXCLUDED_FROM_BACKEND = [
    'DeleteRenderPreset',
    'GetAppVersion',
    'GetModelMeta',
    'GetPath',
    'GetThumbnailBatch',
    'ListDir',
    'OpenInBlender',
    'OpenInMMD',
    'ReadFileBytes', // 由小写 readFileBytes（base64 解码版）替代
    'RenameModelPreset',
    'SaveEnvPreset',
    'SaveModelPresetToLib',
    'SaveSceneFile',
    'SelectAudioFile',
    'SelectEnvTextureFile',
    'SelectPMXFile',
    'SelectVMDMotion',
    'SelectVPDPose',
    'SetWailsApp',
    'StartWatchDir',
    'StopFileServer',
    'StopWatchDir',
    'ToggleFavorite',
    'DeleteMotionPreset',
    'GetMotionPresets',
    'LoadMotionPreset',
    'LoadMotionPresetFromLib',
    'RenameMotionPreset',
    'SaveMotionPreset',
    'SaveMotionPresetToLib',
    'SaveMotionPresetToLibAuto',
    'SelectMotionPresetOpenFile',
    'SelectMotionPresetSaveFile',
] as const;
type _ExcludedCandidate = (typeof EXCLUDED_FROM_BACKEND)[number];
// 用 Extract<keyof GoApp, ...> 确保仅取 GoApp 实际存在的键，拼写偏差自动忽略。
type ExcludedFromBackend = Extract<keyof GoApp, _ExcludedCandidate>;

/**
 * 统一后端抽象。go-adapter 透传 Go 全量（含契约测试 139 函数），
 * browser-adapter 实现 106（81 真实 + 8 FSA + 17 降级）。
 */
/**
 * [doc:adr-277] Wails 的 `$CancellablePromise` 只是传输层细节（`.cancel()` / `.cancelOn()` 全仓 0 调用），
 * 契约只承诺 Promise。抹平它之后 browser-adapter 的对象字面量才能直接满足接口 ——
 * 舍此只能靠 `as unknown as` 硬断，而硬断会同时关掉 this 的类型与多余属性检查。
 */
type PlainReturn<F> = F extends (...args: infer A) => Promise<infer R>
    ? (...args: A) => Promise<R>
    : F;

export type BackendService = {
    [K in Exclude<keyof GoApp, ExcludedFromBackend | 'GetConfig'>]: PlainReturn<GoApp[K]>;
} & {
    readonly kind: 'go' | 'browser';
    capabilities(): BackendCapabilities;
    /**
     * [doc:adr-277] 契约收窄：生成绑定声明的是 `Config | null`（Go 侧返回 `*Config`），
     * 但 `internal/app/config.go` 在 err == nil 时恒非 nil（:62 兜底 `return &Config{}, nil`）。
     * 那个 null 从来不存在，却在 strictNullChecks 下逼着几十处调用点各自跟它缠斗；
     * 收窄到非空后，唯一的 null 通道是「桥未就绪」，由 assertConfig 一处报错。
     */
    GetConfig(): Promise<Config>;
    /** Wails v3 base64 透明解码版（替换原生 ReadFileBytes 大写）。 */
    readFileBytes(path: string): Promise<Uint8Array | null>;
};

/** 见上：GetConfig 的唯一 null 通道（桥未就绪）在这里抛出名字明确的错误。 */
export function assertConfig(cfg: Config | null | undefined): Config {
    if (!cfg) {
        throw new Error('backend: GetConfig 返回 null（后端未就绪？）');
    }
    return cfg;
}

/** 浏览器侧原生独占能力的统一错误。调用方据 capabilities() 预判或 catch 此错误。 */
export class NotSupportedError extends Error {
    constructor(what: string) {
        super(`[backend] ${what} 在浏览器环境下不可用（原生独占能力，已按 ADR-176 显式降级）`);
        this.name = 'NotSupportedError';
    }
}
