// [doc:relay] relay 生效判定 —— 网页端远程 API 经 CORS 同源代理转发。
// browser-adapter（实际转发行为）与诊断面板（显示 relay 状态）共用同一判定，
// 避免「显示声称 relay 已启用、实际却直连」的漂移：
// 只有 纯网页平台 + 远程端点 + relayUrl 已配置 三者同时成立，relay 才真正生效。
// 桌面端（Wails / go 适配器）由 Go 直连 API，不存在 CORS 问题，relay 不参与。

import { isWebPlatform } from '../platform';

/** 端点是否为远程 API（非 localhost/127.0.0.1），远程端点才需要 relay 代理。 */
export function isRemoteEndpoint(endpoint: string): boolean {
    return !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(endpoint);
}

/** 获取 relay 目标 URL：网页端 + 远程端点 + relayUrl 已配置时返回 relayUrl，否则 null（直连）。 */
export function relayTarget(relayUrl: string, endpoint: string): string | null {
    if (!relayUrl || !endpoint) {
        return null;
    }
    if (!isWebPlatform()) {
        return null;
    }
    if (!isRemoteEndpoint(endpoint)) {
        return null;
    }
    return relayUrl;
}
