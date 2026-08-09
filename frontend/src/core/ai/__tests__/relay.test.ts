// [doc:relay] relay 生效判定守护测试：与 browser-adapter 的转发行为保持同一判定，
// 防止「显示声称 relay 已启用、实际却直连」（桌面端误报）回归。

import { describe, it, expect, vi, afterEach } from 'vitest';
import { isRemoteEndpoint, relayTarget } from '../relay';

const RELAY = 'https://mikumikuar-ai-relay.mikumikuar-app.workers.dev';
const REMOTE = 'https://api.deepseek.com/v1/chat/completions';
const LOCAL = 'http://localhost:11434/v1/chat/completions';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('isRemoteEndpoint', () => {
    it('localhost / 127.0.0.1 → false（本机直连）', () => {
        expect(isRemoteEndpoint('http://localhost:11434/v1/chat/completions')).toBe(false);
        expect(isRemoteEndpoint('http://127.0.0.1:11434/v1/chat/completions')).toBe(false);
        expect(isRemoteEndpoint('http://localhost/')).toBe(false);
    });

    it('远程端点 → true', () => {
        expect(isRemoteEndpoint('https://api.deepseek.com/v1/chat/completions')).toBe(true);
        expect(isRemoteEndpoint('http://example.com/v1/chat/completions')).toBe(true);
    });
});

describe('relayTarget', () => {
    it('网页平台 + 远程端点 + relayUrl → 返回 relayUrl（relay 真正生效）', () => {
        vi.stubGlobal('window', {});
        expect(relayTarget(RELAY, REMOTE)).toBe(RELAY);
    });

    it('非网页平台（window.wails 存在，桌面 Wails）→ null（Go 直连，relay 不参与）', () => {
        vi.stubGlobal('window', { wails: {} });
        expect(relayTarget(RELAY, REMOTE)).toBeNull();
    });

    it('无 window（非浏览器环境）→ null', () => {
        // vitest 默认 node 环境，window 未定义
        expect(relayTarget(RELAY, REMOTE)).toBeNull();
    });

    it('本地端点即使配置了 relayUrl → null（不代理本机）', () => {
        vi.stubGlobal('window', {});
        expect(relayTarget(RELAY, LOCAL)).toBeNull();
    });

    it('relayUrl 为空 → null（直连）', () => {
        vi.stubGlobal('window', {});
        expect(relayTarget('', REMOTE)).toBeNull();
    });

    it('endpoint 为空 → null', () => {
        vi.stubGlobal('window', {});
        expect(relayTarget(RELAY, '')).toBeNull();
    });
});
