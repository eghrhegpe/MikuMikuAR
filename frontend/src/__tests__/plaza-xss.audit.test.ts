// [audit:fix 2026-10] MikuMikuAR round75 P1 回归：plaza-browser XSS 转义。
// 远端 plaza 配置 / 用户缓存数据（site.name/site.icon、自定义预设 cp.label、
// 创作者 cr.name 头像首字符、cr.tag/cr.tier 模板位）必须全部走 escapeHtml 后再进
// innerHTML，否则投毒载荷（<img onerror>、属性逃逸）会注入真实 DOM 元素。
// mock 策略同 plaza.contract.test.ts（plaza-download + wails-bindings），
// 用真实 plaza-state + buildSiteTabs/renderSiteContent 验证真实 DOM 输出。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import { buildSiteTabs, renderSiteContent } from '../menus/plaza-browser';
import { setAllSites, setAllCreators, setCurrentSiteId } from '../menus/plaza-state';
import type { PlazaSite } from '../menus/plaza-sites';
import type { PlazaCreator } from '../menus/plaza-creators';
import { bundles } from '../core/i18n/t';

const XSS = '<img src=x onerror=alert(1)>';

describe('plaza-browser P1 XSS 转义 [audit:fix 2026-10]', () => {
    beforeEach(() => {
        bundles['zh-CN'] = { 'plaza.searchTerms': '网页搜索词' };
        setAllSites([]);
        setAllCreators([]);
        setCurrentSiteId('');
    });

    afterEach(() => {
        setAllSites([]);
        setAllCreators([]);
        setCurrentSiteId('');
        localStorage.removeItem('miku.plaza.presets.audit-site');
        localStorage.removeItem('miku.plaza.favCreators');
        document.body.innerHTML = '';
    });

    it('site tab：site.name/site.icon 注入载荷被转义（分组 + 未分组两个分支）', () => {
        const inGroup: PlazaSite = {
            id: 'mzhouse', // SITE_GROUPS 分组内 → 走分组 tab 循环
            name: XSS,
            url: 'https://www.aplaybox.com/',
            mode: 'window',
            icon: '<svg onload=alert(1)>',
        };
        const inOthers: PlazaSite = {
            id: 'evil-site', // 不在 SITE_GROUPS → 走未分组 tab 循环
            name: XSS,
            url: 'https://evil.test/',
            mode: 'external',
            icon: '<svg onload=alert(1)>',
        };
        setAllSites([inGroup, inOthers]);
        setCurrentSiteId('mzhouse');

        const tabs = buildSiteTabs();
        document.body.appendChild(tabs);

        // 载荷不得注入真实 img/svg 元素
        expect(tabs.querySelectorAll('img').length).toBe(0);
        expect(tabs.querySelectorAll('svg').length).toBe(0);
        // 载荷仍应以惰性文本形式可见
        expect(tabs.textContent).toContain(XSS);
        // 序列化后不得再出现原始载荷
        expect(tabs.innerHTML).not.toContain(XSS);
    });

    it('自定义预设 cp.label 注入载荷被转义', () => {
        const site: PlazaSite = {
            id: 'audit-site',
            name: 'Audit',
            url: 'https://audit.test/',
            mode: 'external',
            searchUrl: 'https://audit.test/search?value={{q}}',
        };
        localStorage.setItem(
            'miku.plaza.presets.audit-site',
            JSON.stringify([{ label: XSS, q: 'q1' }])
        );

        const container = renderSiteContent(site);
        document.body.appendChild(container);

        const presetBtn = container.querySelector('.plaza-preset-custom');
        expect(presetBtn).not.toBeNull();
        expect(container.querySelectorAll('img').length).toBe(0);
        expect(presetBtn!.innerHTML).not.toContain(XSS);
        expect(presetBtn!.textContent).toContain(XSS);
    });

    it('创作者卡片：name/desc 载荷被转义，tag/tier 属性逃逸载荷被惰性化', () => {
        const site: PlazaSite = {
            id: 'evil-site',
            name: 'Evil',
            url: 'https://evil.test/',
            mode: 'external',
            searchUrl: 'https://evil.test/search?value={{q}}',
        };
        // 模拟未经运行时类型校验的远端配置 JSON（真实注入面：
        // plaza-creators.ts 只有类型 union，JSON.parse 结果不会校验）
        const cr = JSON.parse(
            JSON.stringify({
                name: XSS,
                desc: XSS,
                tag: 'oc" onmouseover="alert(1)',
                tier: 'gold" onfocus="alert(1)',
                site: 'evil-site',
            })
        ) as PlazaCreator;
        setAllSites([site]);
        setAllCreators([cr]);

        const container = renderSiteContent(site);
        document.body.appendChild(container);

        // 载荷不得注入真实元素 / 属性逃逸出事件处理器
        expect(container.querySelectorAll('img').length).toBe(0);
        expect(container.querySelector('[onmouseover]')).toBeNull();
        expect(container.querySelector('[onfocus]')).toBeNull();
        // 头像首字符、name、desc 均为惰性文本
        const card = container.querySelector<HTMLDivElement>('.plaza-cr-card');
        expect(card).not.toBeNull();
        expect(container.querySelector('.plaza-cr-avatar')?.textContent).toBe(
            XSS.charAt(0).toUpperCase()
        );
        expect(container.querySelector('.plaza-cr-name')?.textContent).toBe(XSS);
        expect(container.querySelector('.plaza-cr-desc')?.textContent).toBe(XSS);
        // tag 文本惰性可见（实体解码后），class 值含引号但已无属性边界
        expect(card!.textContent).toContain('oc" onmouseover="alert(1)');
        // data-name 是 dataset DOM 赋值（不经过 HTML 解析），保留原值属预期
        expect(card!.dataset.name).toBe(XSS);
    });
});
