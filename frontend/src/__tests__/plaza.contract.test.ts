// plaza.contract.test.ts — 导出函数存在性 + 签名契约
//
// 验证 showPlaza / closePlaza 签名不变（不执行内部业务逻辑）。
// plaza-browser 会静态引入 plaza-download，后者会拉 library → scene.ts 重链；
// 因此把 plaza-download 整体 mock 掉，避免 Babylon 初始化、事件订阅和全局监听副作用。

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';

vi.mock('../menus/plaza-download', () => ({
    installDownloadListener: vi.fn(),
    installEventListeners: vi.fn(),
    installShortcuts: vi.fn(),
    ensureObserver: vi.fn(),
}));
vi.mock('../core/wails-bindings', () => ({
    FetchPlazaConfig: vi.fn(),
    GetCachedPlazaConfig: vi.fn().mockResolvedValue(['', '']),
    SavePlazaConfig: vi.fn(),
    ReadTextFile: vi.fn(),
    StartProxy: vi.fn(),
    StopProxy: vi.fn(),
    ClosePlazaWindow: vi.fn(),
    PlazaGoBack: vi.fn(),
    PlazaGoForward: vi.fn(),
    PlazaReload: vi.fn(),
    PlazaZoomIn: vi.fn(),
    PlazaZoomOut: vi.fn(),
    PlazaZoomReset: vi.fn(),
    DownloadFromPlaza: vi.fn(),
}));
vi.mock('@bindings/mikumikuar/internal/app/app', () => ({}));

import {
    showPlaza,
    preserveBuiltinRouting,
    normalizeSite,
    renderSiteContent,
} from '../menus/plaza-browser';
import { FetchPlazaConfig } from '../core/wails-bindings';
import { bundles } from '../core/i18n/t';
import {
    allSites,
    closePlaza,
    setAllCreators,
    setAllSites,
    setCurrentSiteId,
    setPlazaIframe,
    setPlazaProxyActive,
    setObserver,
} from '../menus/plaza-state';

describe('plaza 导出契约', () => {
    afterEach(() => {
        // showPlaza 会经过 renderHome/ensureSitesLoaded 写入模块级共享状态；
        // 契约测试不依赖这些状态，跑完复位避免污染同文件后续用例。
        setAllSites([]);
        setAllCreators([]);
        setCurrentSiteId('');
        setPlazaProxyActive(false);
        setPlazaIframe(null);
        setObserver(null);
    });

    it('showPlaza 是异步函数且可正常 resolve', async () => {
        expect(typeof showPlaza).toBe('function');
        await expect(showPlaza()).resolves.toBeUndefined();
    });

    it('closePlaza 是函数且可幂等调用', () => {
        expect(typeof closePlaza).toBe('function');
        expect(() => {
            closePlaza();
            closePlaza();
        }).not.toThrow();
    });
});

// [doc:plaza-spa] 锁定回归：缓存/远程配置丢失 directNavigate 时，内置站点必须仍以源码路由标记为准，
// 否则会静默退回代理 origin → API CORS 白屏。
describe('preserveBuiltinRouting（缓存不得丢弃内置站点路由标记）', () => {
    beforeAll(() => {
        // renderSiteContent 会渲染 i18n 文案；测试环境未 fetch 语言包，补最小 zh-CN bundle 避免告警。
        bundles['zh-CN'] = { 'plaza.searchTerms': '网页搜索词' };
    });

    afterEach(() => {
        setAllSites([]);
        setAllCreators([]);
        setCurrentSiteId('');
    });

    it('缓存缺失 directNavigate 时，内置站点仍以源码 PLAZA_SITES 为准', () => {
        const cached = [
            {
                id: 'mzhouse',
                name: '模之屋',
                url: 'https://www.aplaybox.com/',
                mode: 'external' as const,
            },
        ];
        const out = preserveBuiltinRouting(cached);
        expect(out[0].directNavigate).toBe(true);
    });

    it('缓存显式 false 不覆盖内置 true（路由标记为代码级决策）', () => {
        const cached = [
            {
                id: 'mzhouse',
                name: '模之屋',
                url: 'https://www.aplaybox.com/',
                mode: 'external' as const,
                directNavigate: false,
            },
        ];
        const out = preserveBuiltinRouting(cached);
        expect(out[0].directNavigate).toBe(true);
    });

    it('自定义站点（无内置项）保留自身 directNavigate', () => {
        const custom = [
            {
                id: 'mysite',
                name: 'X',
                url: 'https://x.test/',
                mode: 'external' as const,
                directNavigate: true,
            },
        ];
        const out = preserveBuiltinRouting(custom);
        expect(out[0].directNavigate).toBe(true);
    });

    it('normalizeSite 圆整 directNavigate 字段', () => {
        const s = normalizeSite({
            id: 'a',
            name: 'A',
            url: 'https://a.test/',
            mode: 'external',
            directNavigate: true,
        });
        expect(s?.directNavigate).toBe(true);
    });

    it('normalizeSite 自定义站点缺省直连（directNavigate 默认 true）', () => {
        const s = normalizeSite({ id: 'b', name: 'B', url: 'https://b.test/', mode: 'external' });
        expect(s?.directNavigate).toBe(true);
    });

    it('normalizeSite 自定义站点可显式 false 回退代理（frame-hostile 站点兜底）', () => {
        const s = normalizeSite({
            id: 'c',
            name: 'C',
            url: 'https://c.test/',
            mode: 'embed',
            directNavigate: false,
        });
        expect(s?.directNavigate).toBe(false);
    });

    it('normalizeSite 缺失 id/url 或非法协议时返回 null', () => {
        expect(normalizeSite({ name: 'X', url: 'https://x.test/', mode: 'external' })).toBeNull();
        expect(normalizeSite({ id: 'x', name: 'X', mode: 'external' })).toBeNull();
        expect(
            normalizeSite({ id: 'x', name: 'X', url: 'not-a-url', mode: 'external' })
        ).toBeNull();
        expect(
            normalizeSite({ id: 'x', name: 'X', url: 'javascript:alert(1)', mode: 'external' })
        ).toBeNull();
        expect(
            normalizeSite({ id: 'x', name: 'X', url: 'ftp://x.test/', mode: 'external' })
        ).toBeNull();
    });

    it('normalizeSite 非法 directNavigate 类型按默认 true 处理（仅布尔 false 回退代理）', () => {
        const s = normalizeSite({
            id: 'd',
            name: 'D',
            url: 'https://d.test/',
            mode: 'embed',
            directNavigate: 'false' as unknown as boolean,
        });
        expect(s?.directNavigate).toBe(true);
    });

    it('远程配置更新路径同样不覆盖内置站点路由标记', async () => {
        vi.mocked(FetchPlazaConfig).mockResolvedValue([
            '',
            JSON.stringify([
                {
                    id: 'mzhouse',
                    name: '模之屋',
                    url: 'https://www.aplaybox.com/',
                    mode: 'external',
                    directNavigate: false,
                },
            ]),
        ]);
        setAllSites([]);
        setAllCreators([]);
        setCurrentSiteId('');
        const site = {
            id: 'mzhouse',
            name: '模之屋',
            url: 'https://www.aplaybox.com/',
            mode: 'embed' as const,
            directNavigate: true,
        };
        const container = renderSiteContent(site);
        document.body.appendChild(container);
        try {
            container.querySelector<HTMLButtonElement>('.plaza-update-btn')?.click();
            await vi.waitFor(() => {
                const merged = allSites.find((s) => s.id === 'mzhouse');
                expect(merged?.directNavigate).toBe(true);
            });
        } finally {
            container.remove();
        }
    });
});
