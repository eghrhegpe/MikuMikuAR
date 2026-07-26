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
            fsAccess: false, // 原生对话框，非 FSA
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
            clipboardReliable: !isAndroidPlatform(), // 安卓 WebView 部分版本需手势/API 缺失（A2-06 根因）
            arScope: isAndroidPlatform() ? 'android-app' : 'none', // 仅安卓应用走 ARCore 原生路由
            // [doc:adr-189] GPU 压缩纹理能力探测（运行时，与后端无关）
            ktx2Supported: ktx2.supported,
            ktx2PreferredFormat: ktx2.preferredFormat,
            // [doc:adr-190] 安装/更新能力键：桌面/安卓非对称，集中翻译（唯一 isAndroidPlatform 桥接点）
            installApk: isAndroidPlatform(), // 仅安卓原生下载后拉起 APK
            installLocal: true, // 桌面/安卓均有本地安装器路径
            inAppBrowser: !isAndroidPlatform(), // 桌面 Wails 原生窗口可内嵌；安卓走系统浏览器
            fsSelectDir: !isAndroidPlatform(), // 桌面原生对话框；安卓 WebView 无目录选择
            localStaging: !isAndroidPlatform(), // 桌面级暂存目录；安卓走文档沙箱
            androidStorageMode: isAndroidPlatform(), // 仅安卓专属存储模式切换
        };
    },
} as unknown as BackendService;
