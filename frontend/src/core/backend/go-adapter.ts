// [doc:architecture] Go 后端适配器 — ADR-176
//
// 透传 Wails v3 生成的 @bindings 全量（含契约测试 139 函数）。
// 保留 wails-bindings 的 base64 解码（readFileBytes 替换原生 ReadFileBytes）。
// capabilities() 全开；Wails 生成物由 `wails3 generate bindings -ts` 维护，此处仅消费。

import * as goApp from '@bindings/mikumikuar/internal/app/app';
import type { BackendService, BackendCapabilities } from './types';
import { isAndroidPlatform } from '../platform';
import { detectKtx2Support } from '../gpu-capabilities';

function _decodeBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
}

export const goAdapter: BackendService = {
    ...goApp,
    kind: 'go',
    readFileBytes: async (path: string) => {
        const b64 = await goApp.ReadFileBytes(path);
        return b64 ? _decodeBase64(b64) : null;
    },
    capabilities: (): BackendCapabilities => {
        const ktx2 = detectKtx2Support();
        return {
            // [doc:adr-178] ar = AR 相机透视（getUserMedia），桌面/安卓均可用；保持 true（非原生 ARCore 独占）
            ar: true,
            externalApps: true,
            plazaWindow: true,
            fsAccess: false, // 原生桌面/安卓用原生对话框，不走 FSA（File System Access API）；fsAccess 仅指 FSA 能力，非"文件系统不可用"
            watchDir: !isAndroidPlatform(), // 桌面应用可监听目录；安卓应用 WebView 无此能力（与历史 !isAndroidPlatform() 门控一致）
            proxyServer: true,
            fileServer: true,
            systemDirOpen: true,
            storageMode: true,
            screenshotSave: true,
            cacheManage: true,
            configPersist: true,
            modelScan: true,
            // [doc:adr-178] 宿主级运行时键：读运行时自报，禁硬编码（安卓应用 crossOriginIsolated 恒 false）
            crossOriginIsolated:
                typeof window !== 'undefined' &&
                (window as { crossOriginIsolated?: boolean }).crossOriginIsolated === true,
            clipboardReliable: !isAndroidPlatform(), // 安卓 WebView 部分版本需手势/API 缺失（A2-06 根因）；调用点已用 try/catch 兜底（toast.ts:141），勿加额外 if (!clipboardReliable) 守卫
            arScope: isAndroidPlatform() ? 'android-app' : 'none', // 仅安卓应用走 ARCore 原生路由
            // [doc:adr-189] GPU 压缩纹理能力探测（运行时，与后端无关）
            ktx2Supported: ktx2.supported,
            ktx2PreferredFormat: ktx2.preferredFormat,
            // [doc:adr-190] 安装/更新能力键：桌面/安卓非对称，集中翻译（唯一 isAndroidPlatform 桥接点）
            installApk: isAndroidPlatform(), // 仅安卓原生下载后拉起 APK
            installLocal: true, // 桌面/安卓均有本地安装器路径
            inAppBrowser: !isAndroidPlatform(), // 桌面 Wails 原生窗口可内嵌；安卓走系统浏览器
            // 安卓禁用目录选择：因安卓走 shared 模式（MANAGE_EXTERNAL_STORAGE 授权后 os.ReadDir 直读 /sdcard），
            // 已废弃 SAF（Storage Access Framework）。请勿对安卓调用 SelectDir()——框架会翻译成 SAF 建树（ACTION_OPEN_DOCUMENT_TREE）。
            // 网页端 FSA（File System Access API，ADR-180/183）是另一套机制，与此正交。
            fsSelectDir: !isAndroidPlatform(), // 桌面原生对话框；安卓 WebView 无目录选择（shared 模式，无 SAF）
            localStaging: true, // 桌面原生目录 + 安卓 shared 模式 /sdcard/Download（[doc:adr-195] 下载文件夹统一摄入）
            androidStorageMode: isAndroidPlatform(), // 仅安卓专属存储模式切换
        };
    },
} as unknown as BackendService;
